import { useState } from 'react'
import { Badge } from '../common/Badge'
import { ImageLightbox } from '../common/ImageLightbox'
import type { DisplayItem } from '@shared/types/item'
import { buildChatHtml } from './chatEmoji'
import styles from './TimelineItem.module.css'

interface TimelineItemProps {
  item: DisplayItem
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHr < 24) return `${diffHr} 小时前`
  if (diffDay < 7) return `${diffDay} 天前`
  return new Date(isoString).toLocaleDateString('zh-CN')
}

function formatFullTime(isoString: string): string {
  return new Date(isoString).toLocaleString('zh-CN')
}

export function TimelineItem({ item }: TimelineItemProps): JSX.Element {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  // 长文（被插件截断）内联展开：点击"查看更多"后通过 IPC 拉取完整正文
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [fullContent, setFullContent] = useState<{ text: string; html?: string } | null>(null)

  // 判断是否为群聊模式（群聊类型的消息用气泡式展示）
  const isChat = item.feedType === 'group-chat'

  // 解析 metadata（包含 isTruncated、media_type 等插件侧标记）
  let metadata: Record<string, unknown> = {}
  try {
    metadata = item.metadata ? JSON.parse(item.metadata) : {}
  } catch {
    metadata = {}
  }
  const isTruncated = !!metadata.isTruncated
  const mediaType = metadata.media_type as number | undefined
  // 微博群聊：media_type=1 为图片，media_type=10 为视频
  const isVideoMessage = mediaType === 10
  console.log('[TimelineItem] render', item.id, '| isTruncated=', isTruncated, '| media_type=', mediaType, '| contentTextLen=', (item.contentText || '').length, '| hasPermalink=', !!item.permalink)

  // 点击"查看更多"：通过 IPC 拉取单条微博完整正文并内联展开
  const handleViewMore = async () => {
    console.log('[TimelineItem] handleViewMore CLICKED for item', item.id, '| detailLoading=', detailLoading, '| fullContent=', !!fullContent)
    if (detailLoading || fullContent) {
      console.log('[TimelineItem] handleViewMore ABORT (already loading or has content)')
      return
    }
    setDetailLoading(true)
    setDetailError(null)
    try {
      console.log('[TimelineItem] calling window.api.getItemDetail...')
      const result = await window.api.getItemDetail(item.id)
      console.log('[TimelineItem] getItemDetail RESULT:', JSON.stringify(result).slice(0, 800))
      if (result?.content) {
        console.log('[TimelineItem] setting fullContent, textLen=', result.content.text?.length)
        setFullContent(result.content)
      } else {
        throw new Error('返回内容为空')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[TimelineItem] 获取完整内容失败:', msg, err)
      setDetailError(msg)
    } finally {
      setDetailLoading(false)
      console.log('[TimelineItem] handleViewMore DONE, detailError=', detailError)
    }
  }

  let mediaUrls: string[] = []
  try {
    mediaUrls = typeof item.mediaUrls === 'string' ? JSON.parse(item.mediaUrls) : item.mediaUrls
  } catch {
    mediaUrls = []
  }

  // 内容：优先使用"查看更多"拉取的完整正文，否则使用列表接口返回的正文
  const activeContentText = fullContent ? fullContent.text : (item.contentText || '')
  const activeContentHtml = fullContent ? fullContent.html : item.contentHtml

  // 图片 URL：以图片扩展名结尾，或是微博 msget 图片接口
  const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
  const isImageUrl = (url: string): boolean => {
    const lower = url.toLowerCase().split('?')[0]
    // X 图片形如 https://pbs.twimg.com/media/xxx.jpg:large，
    // 去掉末尾的尺寸后缀（:large/:orig/:small/:medium/:thumb 或 :1500x1500）再判扩展名
    const withoutSizeSuffix = lower.replace(/:(thumb|small|medium|large|orig|\d+x\d+)$/, '')
    if (IMAGE_EXTENSIONS.some((ext) => withoutSizeSuffix.endsWith(ext))) return true
    if (url.includes('upload.api.weibo.com/2/mss/msget')) return true
    if (url.includes('sinaimg.cn')) return true
    return false
  }
  // 视频消息（media_type=10）：所有 mediaUrls 都是视频
  // 普通消息：非图片的媒体 URL 视为视频
  const videoUrl = isVideoMessage
    ? mediaUrls[0]
    : mediaUrls.find((url) => !isImageUrl(url))
  // 图片 URL
  const imageUrls = isVideoMessage ? [] : mediaUrls.filter((url) => isImageUrl(url))

  if (isChat) {
    const chatHtml = buildChatHtml(item.contentText || '')
    return (
      <article className={`${styles.chatItem} ${item.read ? '' : styles.unread}`} data-chat-item-id={item.id}>
        <div className={styles.chatHeader}>
          {item.authorAvatar ? (
            <img className={styles.chatAvatar} src={item.authorAvatar} alt="" />
          ) : (
            <span className={styles.chatAvatarPlaceholder}>
              {item.authorName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className={styles.chatAuthorName}>{item.authorName}</span>
          <time className={styles.chatTime} dateTime={item.publishedAt} title={formatFullTime(item.publishedAt)}>
            {formatRelativeTime(item.publishedAt)}
          </time>
        </div>

        <div className={styles.chatBody}>
          {/* 群聊内容默认展示全部，不折叠 */}
          <div
            className={styles.chatContent}
            dangerouslySetInnerHTML={{ __html: chatHtml }}
          />

          {/* 视频播放 */}
          {videoUrl && (
            <div className={styles.videoContainer}>
              <video
                className={styles.video}
                src={videoUrl}
                controls
                preload="metadata"
                playsInline
              />
            </div>
          )}

          {imageUrls.length > 0 && (
            <div className={`${styles.chatMediaGrid} ${imageUrls.length === 1 ? styles.single : ''}`}>
              {imageUrls.slice(0, 4).map((url, i) => (
                <img
                  key={i}
                  className={styles.chatMedia}
                  src={url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  onClick={() => setLightboxSrc(url)}
                />
              ))}
            </div>
          )}
        </div>

        {lightboxSrc && (
          <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
        )}
      </article>
    )
  }

  // ---- 普通模式：卡片式展示 ----
  return (
    <article className={`${styles.card} ${item.read ? '' : styles.unread}`} data-item-id={item.id}>
      <div className={styles.header}>
        <div className={styles.author}>
          {item.authorAvatar ? (
            <img className={styles.avatar} src={item.authorAvatar} alt="" />
          ) : (
            <span className={styles.avatarPlaceholder}>
              {item.authorName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className={styles.authorName}>{item.authorName}</span>
        </div>
        <Badge
          label={item.pluginName}
          color={item.pluginColor}
          size="sm"
        />
      </div>

      <div className={styles.body}>
        {activeContentHtml ? (
          <div
            className={styles.content}
            dangerouslySetInnerHTML={{ __html: activeContentHtml }}
          />
        ) : (
          <p className={styles.content}>
            {activeContentText}
          </p>
        )}

        {/* 文本被截断时显示"查看更多"：内联拉取完整正文，不再跳转浏览器 */}
        {isTruncated && !fullContent && (
          <button
            className={styles.viewMoreLink}
            onClick={handleViewMore}
            disabled={detailLoading}
          >
            {detailLoading ? '加载中…' : '查看更多 →'}
          </button>
        )}

        {/* 拉取完整正文失败时，显示错误原因，并回退为在浏览器中打开原帖 */}
        {isTruncated && detailError && (
          <div className={styles.detailError}>
            <span className={styles.detailErrorText}>{detailError}</span>
            {item.permalink && (
              <a
                className={styles.viewMoreLink}
                href={item.permalink}
                target="_blank"
                rel="noopener noreferrer"
              >
                在浏览器中查看 →
              </a>
            )}
          </div>
        )}

        {/* 视频播放 */}
        {videoUrl && (
          <div className={styles.videoContainer}>
            <video
              className={styles.video}
              src={videoUrl}
              controls
              preload="metadata"
              playsInline
            />
          </div>
        )}

        {/* 图片网格 */}
        {imageUrls.length > 0 && (
          <div className={`${styles.mediaGrid} ${imageUrls.length === 1 ? styles.single : ''}`}>
            {imageUrls.slice(0, 4).map((url, i) => (
              <img
                key={i}
                className={styles.media}
                src={url}
                alt=""
                loading="lazy"
                onClick={() => setLightboxSrc(url)}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <time
          className={styles.time}
          dateTime={item.publishedAt}
          title={formatFullTime(item.publishedAt)}
        >
          {formatRelativeTime(item.publishedAt)}
        </time>
        {item.permalink && (
          <a
            className={styles.link}
            href={item.permalink}
            title="在原站打开"
            onClick={(e) => {
              e.preventDefault()
              window.open(item.permalink, '_blank')
            }}
          >
            🔗
          </a>
        )}
      </div>

      {/* 图片灯箱 */}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </article>
  )
}
