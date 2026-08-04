import { getAll, getModule } from '../plugin-system/registry'

export interface ProviderInfo {
  provider: string
  providerName: string
  domains: string[]
  hasVerify: boolean
}

/** Build a provider→domains map and a domain→provider reverse map from all
 *  registered plugins. Plugins declare `cookieDomains` in their meta;
 *  plugins of the same provider share the same cookie, so domains are
 *  merged per provider. */
export function buildProviderMaps(): {
  providerInfo: Map<string, ProviderInfo>
  domainToProvider: Map<string, string>
} {
  const providerInfo = new Map<string, ProviderInfo>()
  const domainToProvider = new Map<string, string>()

  for (const plugin of getAll()) {
    const provider = plugin.meta.provider ?? plugin.meta.id
    const providerName = plugin.meta.providerName ?? plugin.meta.name
    const domains = plugin.meta.cookieDomains ?? []

    if (!providerInfo.has(provider)) {
      providerInfo.set(provider, {
        provider,
        providerName,
        domains: [],
        hasVerify: false,
      })
    }
    const info = providerInfo.get(provider)!
    for (const d of domains) {
      if (!info.domains.includes(d)) {
        info.domains.push(d)
      }
      // domain → provider (exact + subdomain matching handled at lookup time)
      domainToProvider.set(d, provider)
    }

    // Check if any plugin of this provider supports cookie verification
    const mod = getModule(plugin.meta.id)
    if (mod && typeof mod.verifyCookie === 'function') {
      info.hasVerify = true
    }
  }

  return { providerInfo, domainToProvider }
}

/** Match a domain (possibly a subdomain) to a provider.
 *  e.g. "www.weibo.com" → "weibo" via the "weibo.com" entry. */
export function matchProvider(domain: string, domainToProvider: Map<string, string>): string | undefined {
  if (domainToProvider.has(domain)) return domainToProvider.get(domain)
  for (const [key, provider] of domainToProvider) {
    if (domain.endsWith('.' + key)) return provider
  }
  return undefined
}
