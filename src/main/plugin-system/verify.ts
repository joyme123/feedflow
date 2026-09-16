// ============================================================
// verify.ts — 已存储凭据的异步校验
//
// /sync 只负责落库，不再同步校验 Cookie；校验由用户在「设置 → 凭据」
// 中通过 credentials:verify IPC 按需触发，结果持久化到凭据上
//（lastVerifyStatus / lastVerifyError / lastVerifiedAt）。
// ============================================================

import { getAll, getModule } from './registry'
import * as credentialQueries from '../database/queries/credentials'
import { runWithProxyContext } from '../network/proxy-context'
import { providerUsesProxy } from '../network/proxy-agent'

export interface VerifyCookieResult {
  valid: boolean
  uid?: string
  screenName?: string
  error?: string
}

type VerifyCookieFn = (cookie: string) => Promise<VerifyCookieResult>

/** Find a plugin for a provider that supports cookie verification */
export function findVerifyPlugin(provider: string): { pluginId: string; verifyCookie: VerifyCookieFn } | null {
  for (const plugin of getAll()) {
    const p = plugin.meta.provider ?? plugin.meta.id
    if (p !== provider) continue
    const mod = getModule(plugin.meta.id)
    if (mod && typeof mod.verifyCookie === 'function') {
      return { pluginId: plugin.meta.id, verifyCookie: mod.verifyCookie as VerifyCookieFn }
    }
  }
  return null
}

export interface VerifyCredentialResult extends VerifyCookieResult {
  /** 该 provider 没有可用的校验插件（如纯 token 源），调用方无需展示 */
  supported: boolean
}

/**
 * 校验一条已存储凭据，并把结果（含 uid/screenName）持久化。
 * 网络错误等失败原因原样返回，由凭据面板以「验证失败 + 悬浮报错」展示。
 */
export async function verifyCredentialById(id: string): Promise<VerifyCredentialResult> {
  const cred = credentialQueries.getCredentialById(id)
  if (!cred) {
    return { supported: false, valid: false, error: '凭据不存在' }
  }

  const verifyPlugin = findVerifyPlugin(cred.provider)
  if (!verifyPlugin) {
    return { supported: false, valid: false, error: '该凭据不支持校验' }
  }

  let result: VerifyCookieResult
  try {
    result = await runWithProxyContext(providerUsesProxy(cred.provider), () =>
      verifyPlugin.verifyCookie(cred.value)
    )
  } catch (err) {
    result = { valid: false, error: err instanceof Error ? err.message : String(err) }
  }

  const now = Date.now()
  if (result.valid) {
    // 保留 extra 中已有字段，合并校验得到的 uid/screenName
    const extra: Record<string, unknown> = { ...cred.extra }
    if (result.uid) extra.uid = result.uid
    if (result.screenName) extra.screenName = result.screenName
    credentialQueries.updateCredential(id, {
      extra,
      lastVerifiedAt: now,
      lastVerifyStatus: 'success',
      lastVerifyError: null,
    })
  } else {
    credentialQueries.updateCredential(id, {
      lastVerifiedAt: now,
      lastVerifyStatus: 'failed',
      lastVerifyError: result.error ?? '校验失败',
    })
  }

  return { supported: true, ...result }
}
