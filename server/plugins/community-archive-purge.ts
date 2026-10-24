import { purgeExpiredCommunityContent } from '~~/server/utils/communityArchive'

const SIX_HOURS = 6 * 60 * 60 * 1000

/**
 * 社区归档清理：撤回/删除的数据保留 30 天，由该任务定期物理删除。
 * 管理后台归档列表也会在读取时顺手清理一次，避免任务未执行时仍显示过期数据。
 */
export default defineNitroPlugin(() => {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const result = await purgeExpiredCommunityContent()
      if (result.posts || result.comments) {
        console.info(`[community] 归档清理完成：帖子 ${result.posts} 条，评论 ${result.comments} 条`)
      }
    } catch (error) {
      console.error('[community] 归档清理失败:', error)
    } finally {
      running = false
    }
  }

  const timer = setInterval(run, SIX_HOURS)
  timer.unref?.()
  const firstRun = setTimeout(run, 30_000)
  firstRun.unref?.()
})
