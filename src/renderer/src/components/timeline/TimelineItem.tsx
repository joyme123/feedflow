import { useState } from 'react'
import { Badge } from '../common/Badge'
import { ImageLightbox } from '../common/ImageLightbox'
import type { DisplayItem } from '@shared/types/item'
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
  const [expanded, setExpanded] = useState(false)

  // 解析 metadata（包含 isTruncated 等插件侧标记）
  let metadata: Record<string, unknown> = {}
  try {
    metadata = item.metadata ? JSON.parse(item.metadata) : {}
  } catch {
    metadata = {}
  }
  const isTruncated = !!metadata.isTruncated

  let mediaUrls: string[] = []
  try {
    mediaUrls = typeof item.mediaUrls === 'string' ? JSON.parse(item.mediaUrls) : item.mediaUrls
  } catch {
    mediaUrls = []
  }

  // 判断内容是否需要展开/收起（超过阈值字符数视为长内容）
  const EXPAND_THRESHOLD = 300
  const contentPlain = item.contentText || ''
  const needsExpand = contentPlain.length > EXPAND_THRESHOLD
  const contentCollapsed = needsExpand && !expanded

  // 检测视频 URL（微博视频通常是 .mp4 或 .mov 格式）
  const videoUrl = mediaUrls.find(
    (url) => url.endsWith('.mp4') || url.endsWith('.mov') || url.includes('video') || url.includes('.mp4?')
  )
  // 图片 URL（排除视频）
  const imageUrls = mediaUrls.filter(
    (url) => !url.endsWith('.mp4') && !url.endsWith('.mov') && !url.includes('video')
  )

  return (
    <article className={styles.card}>
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
        {item.contentHtml ? (
          <div
            className={`${styles.content} ${contentCollapsed ? styles.contentCollapsed : ''}`}
            dangerouslySetInnerHTML={{ __html: item.contentHtml }}
          />
        ) : (
          <p className={`${styles.content} ${contentCollapsed ? styles.contentCollapsed : ''}`}>
            {item.contentText}
          </p>
        )}

        {/* 展开/收起按钮 */}
        {needsExpand && (
          <button
            className={styles.expandButton}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? '收起' : '展开'}
          </button>
        )}

        {/* 文本被截断时显示"查看更多"链接（在浏览器中打开原帖查看完整内容） */}
        {isTruncated && item.permalink && (
          <a
            className={styles.viewMoreLink}
            href={item.permalink}
            target="_blank"
            rel="noopener noreferrer"
          >
            查看更多 →
          </a>
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
