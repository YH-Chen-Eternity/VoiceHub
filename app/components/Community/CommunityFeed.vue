<template>
  <div class="community-shell custom-scrollbar">
    <div class="community-head">
      <div class="community-head-main">
        <h2 class="community-title">{{ t.title }}</h2>
        <p class="community-subtitle">{{ t.subtitle }}</p>
      </div>
      <div class="community-head-actions">
        <NotificationCenter />
        <button v-if="canReview" class="ghost-button" type="button" @click="goReview">
          <ShieldCheck :size="16" />
          <span>{{ t.goReview }}</span>
        </button>
        <button
          class="primary-button"
          :disabled="!settings.enabled || ban.muted"
          type="button"
          @click="openPublish"
        >
          <Plus :size="16" />
          <span>{{ t.publish }}</span>
        </button>
      </div>
    </div>

    <div v-if="loading" class="state-card">
      <Loader2 class="animate-spin" :size="26" />
      <p>{{ t.loading || '正在加载…' }}</p>
    </div>

    <div v-else-if="fatalError" class="state-card">
      <AlertTriangle :size="26" />
      <p>{{ fatalError }}</p>
      <button class="ghost-button" type="button" @click="init">{{ t.retry || '重试' }}</button>
    </div>

    <div v-else-if="!isOpen" class="state-card">
      <Lock :size="26" />
      <h3>{{ t.disabledTitle }}</h3>
      <p>{{ t.disabledDesc }}</p>
      <button v-if="canReview" class="ghost-button" type="button" @click="goReview">
        <ShieldCheck :size="16" />
        <span>{{ t.goReview }}</span>
      </button>
    </div>

    <template v-else>
      <div v-if="ban.muted" class="mute-banner">
        <Lock :size="16" />
        <div>
          <span>{{ t.muted }}</span>
          <span v-if="ban.permanent" class="mute-extra">· {{ t.permanent }}</span>
          <span v-else-if="ban.until" class="mute-extra">· {{ t.muteUntil }} {{ formatDate(ban.until) }}</span>
          <span v-if="ban.reason" class="mute-extra">· {{ ban.reason }}</span>
        </div>
      </div>

      <div v-if="!settings.enabled" class="closed-banner">
        <Info :size="16" />
        <span>{{ t.closedForUsers }}</span>
      </div>

      <div class="board-rail" role="tablist">
        <button
          :class="{ active: activeBoardId === 0 }"
          class="board-chip"
          type="button"
          @click="selectBoard(0)"
        >
          {{ t.boardAll }}
        </button>
        <button
          v-for="board in boards"
          :key="board.id"
          :class="{ active: activeBoardId === board.id, dimmed: !board.isActive }"
          class="board-chip"
          type="button"
          @click="selectBoard(board.id)"
        >
          <span>{{ board.name }}</span>
          <span class="board-count">{{ board.postCount }}</span>
        </button>
      </div>

      <div class="community-grid">
        <main class="community-main">
          <div class="feed-controls">
            <label class="feed-search">
              <Search :size="14" />
              <input
                v-model="searchQuery"
                :placeholder="t.searchPlaceholder"
                type="search"
                @input="onSearchInput"
              >
            </label>
            <div class="feed-sort">
              <button
                :class="{ active: sortMode === 'latest' }"
                type="button"
                @click="setSort('latest')"
              >
                {{ t.sortLatest }}
              </button>
              <button
                :class="{ active: sortMode === 'hot' }"
                type="button"
                @click="setSort('hot')"
              >
                {{ t.sortHot }}
              </button>
            </div>
          </div>

          <div class="feed-toolbar">
            <span v-if="filterMine" class="feed-hint">{{ t.myPosts }}</span>
            <span v-else-if="activeBoardId" class="feed-hint">
              {{ boards.find((item) => item.id === activeBoardId)?.name }}
            </span>
            <button
              :class="{ active: filterMine }"
              class="mine-toggle"
              type="button"
              @click="toggleMine"
            >
              <UserRound :size="14" />
              <span>{{ t.filterMine }}</span>
            </button>
          </div>

          <div v-if="feedLoading && !posts.length" class="feed-state">
            <Loader2 class="animate-spin" :size="22" />
          </div>

          <div v-else-if="!posts.length" class="feed-state">
            <MessageCircle :size="26" />
            <p>{{ t.empty }}</p>
          </div>

          <div v-else class="feed-list">
            <article v-for="post in posts" :key="post.id" class="post-card">
              <header class="post-head">
                <button class="identity" type="button" @click="openProfile(post.author.id)">
                  <span class="identity-name">{{ post.author.displayName }}</span>
                  <span class="identity-meta">
                    <span v-if="post.author.title" class="identity-title">{{ post.author.title }}</span>
                    <span class="identity-board">{{ post.board.name }}</span>
                  </span>
                </button>
                <span class="post-time">
                  <span v-if="post.pinned" class="pinned-badge"><Pin :size="11" />{{ t.pinnedBadge }}</span>
                  {{ formatTime(post.createdAt) }}
                </span>
              </header>

              <div v-if="post.status !== 'APPROVED'" class="status-row">
                <span :class="['status-pill', `status-${post.status.toLowerCase()}`]">
                  {{ statusText(post.status) }}
                </span>
                <span v-if="post.reviewNote" class="status-note">{{ post.reviewNote }}</span>
              </div>

              <p class="post-content">{{ post.content }}</p>

              <div
                v-if="post.images.length"
                :class="['post-images', `images-${post.images.length >= 5 ? 'many' : post.images.length}`]"
              >
                <button
                  v-for="(image, index) in post.images"
                  :key="image.id"
                  class="image-button"
                  type="button"
                  @click="openLightbox(post.images, Number(index))"
                >
                  <img :alt="`图片 ${Number(index) + 1}`" :src="image.url" loading="lazy">
                </button>
              </div>

              <div v-if="post.song" class="song-row">
                <div class="song-cover">
                  <img v-if="post.song.cover" :alt="post.song.title" :src="post.song.cover">
                  <Music v-else :size="18" />
                </div>
                <div class="song-info">
                  <span class="song-title">{{ post.song.title }}</span>
                  <span class="song-artist">{{ post.song.artist }}</span>
                  <span v-if="likeBlockedText(post)" class="song-note">{{ likeBlockedText(post) }}</span>
                </div>
                <button
                  :class="{ liked: post.song.likedByMe }"
                  class="like-button"
                  :disabled="post.liking || !canToggleLike(post)"
                  :title="likeButtonTitle(post)"
                  type="button"
                  @click="toggleLike(post)"
                >
                  <Heart :fill="post.song.likedByMe ? 'currentColor' : 'none'" :size="16" />
                  <span>{{ post.song.voteCount }}</span>
                </button>
              </div>

              <footer class="post-footer">
                <button class="footer-action" type="button" @click="openDetail(post)">
                  <MessageCircle :size="16" />
                  <span>{{ post.commentCount }}</span>
                </button>
                <span class="footer-action footer-static" :title="t.viewCount">
                  <Eye :size="16" />
                  <span>{{ post.viewCount || 0 }}</span>
                </span>
                <button
                  :class="{ liked: post.likedByMe }"
                  class="footer-action footer-like"
                  :title="post.likedByMe ? t.postLikeCancel : t.postLike"
                  type="button"
                  @click="togglePostLike(post)"
                >
                  <Heart :fill="post.likedByMe ? 'currentColor' : 'none'" :size="16" />
                  <span>{{ post.likeCount || 0 }}</span>
                </button>
                <button
                  v-if="!isOwnPost(post)"
                  class="footer-action"
                  type="button"
                  @click="openReport('POST', post.id, post.content)"
                >
                  <Flag :size="16" />
                  <span>{{ t.report || '举报' }}</span>
                </button>
                <button
                  v-if="feedPermissions.canPin && post.status === 'APPROVED'"
                  class="footer-action"
                  type="button"
                  @click="togglePin(post)"
                >
                  <Pin :size="16" />
                  <span>{{ post.pinned ? t.unpin : t.pin }}</span>
                </button>
                <button
                  v-if="canRemovePost(post)"
                  class="footer-action footer-danger"
                  type="button"
                  @click="askRemovePost(post)"
                >
                  <Trash2 :size="16" />
                  <span>{{ isOwnPost(post) ? t.withdraw : t.deleteContent }}</span>
                </button>
              </footer>
            </article>

            <div v-if="nextCursor && sortMode === 'latest'" class="load-more-row">
              <button :disabled="feedLoading" class="ghost-button" type="button" @click="loadFeed()">
                <Loader2 v-if="feedLoading" class="animate-spin" :size="16" />
                <span>{{ t.loadMore }}</span>
              </button>
            </div>
          </div>
        </main>

        <aside class="community-aside">
          <section class="me-card">
            <div class="me-identity">
              <div class="me-avatar">
                <UserRound :size="20" />
              </div>
              <div>
                <p class="me-name">{{ me?.user?.displayName || '—' }}</p>
                <p v-if="me?.user?.title" class="me-title">{{ me.user.title }}</p>
              </div>
            </div>
            <div class="me-stats">
              <div>
                <span class="me-stat-value">{{ me?.stats?.posts ?? 0 }}</span>
                <span class="me-stat-label">{{ t.postCount }}</span>
              </div>
              <div>
                <span class="me-stat-value">{{ me?.stats?.comments ?? 0 }}</span>
                <span class="me-stat-label">{{ t.commentCount }}</span>
              </div>
            </div>
            <p v-if="violationCount > 0" class="me-violation">
              {{ t.violationCount(violationCount) }}
            </p>
            <NuxtLink class="me-link" to="/account">
              <span>{{ t.accountEntry }}</span>
              <ArrowRight :size="14" />
            </NuxtLink>
          </section>

          <NowPlayingCard v-if="isOpen" />

          <section class="rules-card">
            <h3>{{ t.rulesTitle }}</h3>
            <p>{{ t.pendingHint }}</p>
            <p v-if="settings.allowImages">{{ t.imageHint(maxImages) }}</p>
          </section>
        </aside>
      </div>
    </template>

    <!-- 发帖 -->
    <Teleport to="body">
      <Transition name="community-fade">
        <div v-if="publishOpen" class="modal-layer" @click.self="closePublish">
          <div class="modal-card publish-card">
            <header class="modal-head">
              <div>
                <h3>{{ t.publishTitle }}</h3>
                <p>{{ t.publishDesc }}</p>
              </div>
              <button class="icon-button" type="button" @click="closePublish">
                <X :size="18" />
              </button>
            </header>

            <div class="modal-body">
              <div class="publish-as">
                <span class="publish-as-label">{{ t.publishAs }}</span>
                <span class="publish-as-name">{{ me?.user?.displayName || '—' }}</span>
              </div>

              <div class="board-picker">
                <button
                  v-for="board in activeBoards"
                  :key="board.id"
                  :class="{ active: publishForm.boardId === board.id }"
                  class="board-chip"
                  type="button"
                  @click="publishForm.boardId = board.id"
                >
                  {{ board.name }}
                </button>
              </div>

              <div class="field">
                <textarea
                  v-model="publishForm.content"
                  :maxlength="settings.maxContentLength"
                  :placeholder="t.contentPlaceholder"
                  rows="5"
                />
                <div class="field-meta">
                  <span>{{ t.pendingHint }}</span>
                  <span>{{ publishForm.content.length }}/{{ settings.maxContentLength }}</span>
                </div>
              </div>

              <div class="field">
                <div class="field-title">
                  <Music :size="15" />
                  <span>{{ t.attachSong }}</span>
                </div>

                <div v-if="publishForm.song" class="selected-song">
                  <div class="song-cover">
                    <img
                      v-if="publishForm.song.cover"
                      :alt="publishForm.song.title"
                      :src="publishForm.song.cover"
                    >
                    <Music v-else :size="18" />
                  </div>
                  <div class="song-info">
                    <span class="song-title">{{ publishForm.song.title }}</span>
                    <span class="song-artist">{{ publishForm.song.artist }}</span>
                    <span v-if="songBlockedText(publishForm.song)" class="song-note">
                      {{ songBlockedText(publishForm.song) }}
                    </span>
                  </div>
                  <button class="link-button" type="button" @click="publishForm.song = null">
                    {{ t.remove }}
                  </button>
                </div>

                <template v-else>
                  <div class="search-field">
                    <Search :size="15" />
                    <input
                      v-model="songQuery"
                      :placeholder="t.searchSong"
                      type="text"
                      @input="handleSongInput"
                    >
                  </div>
                  <div v-if="songResults.length" class="song-results">
                    <button
                      v-for="song in songResults"
                      :key="song.id"
                      class="song-result"
                      type="button"
                      @click="chooseSong(song)"
                    >
                      <span class="song-result-title">{{ song.title }}</span>
                      <span class="song-result-artist">{{ song.artist }}</span>
                      <span v-if="song.isOwn" class="song-result-own">{{ t.ownSubmission }}</span>
                      <span v-if="song.likedByMe" class="song-result-liked">{{ t.alreadyLiked }}</span>
                      <span
                        v-if="songBlockedText(song)"
                        class="song-result-blocked"
                        :title="songBlockedText(song)"
                      >
                        {{ t.cannotLike }}
                      </span>
                      <span class="song-result-pick">{{ t.choose }}</span>
                    </button>
                  </div>
                  <p v-else-if="songQuery && songSearched" class="muted-text">{{ t.noSongFound }}</p>
                  <p class="field-hint">{{ t.attachSongHint }}</p>
                </template>
              </div>

              <div v-if="settings.allowImages" class="field">
                <div class="field-title">
                  <ImagePlus :size="15" />
                  <span>{{ t.addImages }}</span>
                  <span class="field-title-extra">{{ publishForm.images.length }}/{{ maxImages }}</span>
                </div>
                <div class="image-uploader">
                  <div
                    v-for="(image, index) in publishForm.images"
                    :key="image.id"
                    class="upload-thumb"
                  >
                    <img :alt="`已选图片 ${Number(index) + 1}`" :src="image.url">
                    <button class="thumb-remove" type="button" @click="removeImage(image.id)">
                      <X :size="12" />
                    </button>
                  </div>
                  <button
                    v-if="publishForm.images.length < maxImages"
                    class="upload-add"
                    :disabled="uploading > 0"
                    type="button"
                    @click="imageInput?.click()"
                  >
                    <Loader2 v-if="uploading > 0" class="animate-spin" :size="18" />
                    <ImagePlus v-else :size="18" />
                    <span>{{ uploading > 0 ? t.uploading : t.addImages }}</span>
                  </button>
                </div>
                <p class="field-hint">{{ t.imageHint(maxImages) }}</p>
                <input
                  ref="imageInput"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  class="hidden-input"
                  multiple
                  type="file"
                  @change="handleImageSelect"
                >
              </div>
              <p v-else class="field-hint">{{ t.imagesDisabled }}</p>
            </div>

            <footer class="modal-foot">
              <span class="foot-hint">{{ t.pendingHint }}</span>
              <div class="foot-actions">
                <button class="ghost-button" type="button" @click="closePublish">
                  {{ t.cancel || '取消' }}
                </button>
                <button
                  class="primary-button"
                  :disabled="submitting || !canSubmit"
                  type="button"
                  @click="submitPost"
                >
                  <Loader2 v-if="submitting" class="animate-spin" :size="16" />
                  <span>{{ submitting ? t.submitting : t.submit }}</span>
                </button>
              </div>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 帖子详情 -->
    <Teleport to="body">
      <Transition name="community-fade">
        <div v-if="detailOpen && selectedPost" class="modal-layer" @click.self="closeDetail">
          <div class="modal-card detail-card">
            <header class="modal-head">
              <div class="detail-head-main">
                <span class="identity-board">{{ selectedPost.board.name }}</span>
                <span v-if="selectedPost.status !== 'APPROVED'" :class="['status-pill', `status-${selectedPost.status.toLowerCase()}`]">
                  {{ statusText(selectedPost.status) }}
                </span>
              </div>
              <div class="detail-head-actions">
                <button
                  v-if="canRemovePost(selectedPost)"
                  class="ghost-button detail-remove"
                  type="button"
                  @click="askRemovePost(selectedPost)"
                >
                  <Trash2 :size="14" />
                  <span>{{ isOwnPost(selectedPost) ? t.withdraw : t.deleteContent }}</span>
                </button>
                <button class="icon-button" type="button" @click="closeDetail">
                  <X :size="18" />
                </button>
              </div>
            </header>

            <div class="modal-body detail-body">
              <button class="identity detail-identity" type="button" @click="openProfile(selectedPost.author.id)">
                <span class="identity-name">{{ selectedPost.author.displayName }}</span>
                <span class="identity-meta">
                  <span v-if="selectedPost.author.title" class="identity-title">
                    {{ selectedPost.author.title }}
                  </span>
                  <span class="post-time">{{ formatTime(selectedPost.createdAt) }}</span>
                </span>
              </button>

              <p class="post-content detail-content">{{ selectedPost.content }}</p>

              <div
                v-if="selectedPost.images.length"
                :class="['post-images', `images-${selectedPost.images.length >= 5 ? 'many' : selectedPost.images.length}`]"
              >
                <button
                  v-for="(image, index) in selectedPost.images"
                  :key="image.id"
                  class="image-button"
                  type="button"
                  @click="openLightbox(selectedPost.images, Number(index))"
                >
                  <img :alt="`图片 ${Number(index) + 1}`" :src="image.url" loading="lazy">
                </button>
              </div>

              <div v-if="selectedPost.song" class="song-row">
                <div class="song-cover">
                  <img
                    v-if="selectedPost.song.cover"
                    :alt="selectedPost.song.title"
                    :src="selectedPost.song.cover"
                  >
                  <Music v-else :size="18" />
                </div>
                <div class="song-info">
                  <span class="song-title">{{ selectedPost.song.title }}</span>
                  <span class="song-artist">{{ selectedPost.song.artist }}</span>
                  <span v-if="likeBlockedText(selectedPost)" class="song-note">
                    {{ likeBlockedText(selectedPost) }}
                  </span>
                </div>
                <button
                  :class="{ liked: selectedPost.song.likedByMe }"
                  class="like-button"
                  :disabled="selectedPost.liking || !canToggleLike(selectedPost)"
                  :title="likeButtonTitle(selectedPost)"
                  type="button"
                  @click="toggleLike(selectedPost)"
                >
                  <Heart :fill="selectedPost.song.likedByMe ? 'currentColor' : 'none'" :size="16" />
                  <span>{{ selectedPost.song.voteCount }}</span>
                </button>
              </div>

              <div class="detail-actions">
                <span class="footer-action footer-static">
                  <Eye :size="16" />
                  <span>{{ selectedPost.viewCount || 0 }}</span>
                </span>
                <button
                  :class="{ liked: selectedPost.likedByMe }"
                  class="footer-action footer-like"
                  type="button"
                  @click="togglePostLike(selectedPost)"
                >
                  <Heart :fill="selectedPost.likedByMe ? 'currentColor' : 'none'" :size="16" />
                  <span>{{ selectedPost.likeCount || 0 }}</span>
                </button>
                <button
                  v-if="feedPermissions.canPin && selectedPost.status === 'APPROVED'"
                  class="footer-action"
                  type="button"
                  @click="togglePin(selectedPost)"
                >
                  <Pin :size="16" />
                  <span>{{ selectedPost.pinned ? t.unpin : t.pin }}</span>
                </button>
              </div>

              <div v-if="selectedPost.reviewNote" class="detail-note">
                <span>{{ t.reviewNoteLabel }}</span>
                <p>{{ selectedPost.reviewNote }}</p>
              </div>

              <div class="comment-section">
                <h4>{{ t.comments }} · {{ selectedPost.commentCount }}</h4>
                <div v-if="commentsLoading" class="feed-state">
                  <Loader2 class="animate-spin" :size="20" />
                </div>
                <div v-else-if="!comments.length" class="comment-empty">{{ t.noComments }}</div>
                <div v-else class="comment-list">
                  <div v-for="thread in threads" :key="thread.id" class="comment-item">
                    <div class="comment-head">
                      <button class="identity comment-identity" type="button" @click="openProfile(thread.author.id)">
                        <span class="identity-name">{{ thread.author.displayName }}</span>
                        <span v-if="thread.author.title" class="identity-title">{{ thread.author.title }}</span>
                      </button>
                      <div class="comment-tail">
                        <span
                          v-if="thread.status !== 'APPROVED'"
                          :class="['status-pill', `status-${thread.status.toLowerCase()}`]"
                        >
                          {{ statusText(thread.status) }}
                        </span>
                        <button
                          v-if="selectedPost.status === 'APPROVED' && !ban.muted"
                          class="comment-reply-btn"
                          type="button"
                          @click="startReply(thread)"
                        >
                          {{ t.reply || '回复' }}
                        </button>
                        <button
                          v-if="!isOwnComment(thread)"
                          class="comment-remove"
                          :title="t.report || '举报'"
                          type="button"
                          @click="openReport('COMMENT', thread.id, thread.content)"
                        >
                          <Flag :size="13" />
                        </button>
                        <button
                          v-if="canRemoveComment(thread)"
                          class="comment-remove"
                          :title="isOwnComment(thread) ? t.withdraw : t.deleteContent"
                          type="button"
                          @click="askRemoveComment(thread)"
                        >
                          <Trash2 :size="13" />
                        </button>
                      </div>
                    </div>
                    <p>
                      <span v-for="name in thread.mentionNames || []" :key="name" class="mention-name">@{{ name }} </span>
                      {{ thread.content }}
                    </p>
                    <p v-if="thread.reviewNote" class="comment-note">
                      {{ t.reviewNoteLabel }}：{{ thread.reviewNote }}
                    </p>
                    <span class="comment-time">{{ formatTime(thread.createdAt) }}</span>

                    <div v-if="thread.replies && thread.replies.length" class="comment-replies">
                      <div v-for="reply in thread.replies" :key="reply.id" class="comment-item comment-reply-item">
                        <div class="comment-head">
                          <button class="identity comment-identity" type="button" @click="openProfile(reply.author.id)">
                            <span class="identity-name">{{ reply.author.displayName }}</span>
                            <span v-if="reply.author.title" class="identity-title">{{ reply.author.title }}</span>
                          </button>
                          <div class="comment-tail">
                            <span v-if="reply.replyTo" class="reply-target">回复 {{ reply.replyTo }}</span>
                            <button
                              v-if="!isOwnComment(reply)"
                              class="comment-remove"
                              :title="t.report || '举报'"
                              type="button"
                              @click="openReport('COMMENT', reply.id, reply.content)"
                            >
                              <Flag :size="13" />
                            </button>
                            <button
                              v-if="canRemoveComment(reply)"
                              class="comment-remove"
                              :title="isOwnComment(reply) ? t.withdraw : t.deleteContent"
                              type="button"
                              @click="askRemoveComment(reply)"
                            >
                              <Trash2 :size="13" />
                            </button>
                          </div>
                        </div>
                        <p>
                          <span v-for="name in reply.mentionNames || []" :key="name" class="mention-name">@{{ name }} </span>
                          {{ reply.content }}
                        </p>
                        <span class="comment-time">{{ formatTime(reply.createdAt) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <footer class="comment-foot">
              <template v-if="selectedPost.status === 'APPROVED' && !ban.muted">
                <div v-if="replyTo" class="reply-chip">
                  <span>回复 {{ replyTo.author?.displayName || '' }}</span>
                  <button type="button" @click="cancelReply">
                    <X :size="12" />
                  </button>
                </div>
                <input
                  v-model="commentContent"
                  :maxlength="settings.maxCommentLength"
                  :placeholder="
                    replyTo
                      ? String(t.replyPlaceholder || '回复 @{name}…').replace('{name}', replyTo.author?.displayName || '')
                      : t.commentPlaceholder
                  "
                  class="comment-input"
                  type="text"
                  @keyup.enter="sendComment"
                >
                <button
                  class="primary-button comment-send"
                  :disabled="sendingComment || !commentContent.trim()"
                  type="button"
                  @click="sendComment"
                >
                  <Loader2 v-if="sendingComment" class="animate-spin" :size="16" />
                  <Send v-else :size="16" />
                  <span>{{ t.sendComment }}</span>
                </button>
              </template>
              <p v-else class="foot-hint">
                {{ ban.muted ? t.muted : t.pendingHint }}
              </p>
              <p v-if="selectedPost.status === 'APPROVED' && !ban.muted" class="mention-hint">
                {{ t.mentionHint || '输入 @用户名 可以提醒同学' }}
              </p>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 个人主页 -->
    <Teleport to="body">
      <Transition name="community-fade">
        <div v-if="profileOpen" class="modal-layer" @click.self="closeProfile">
          <div class="modal-card profile-card">
            <header class="modal-head">
              <h3>{{ t.viewProfile }}</h3>
              <button class="icon-button" type="button" @click="closeProfile">
                <X :size="18" />
              </button>
            </header>
            <div class="modal-body">
              <div v-if="profileLoading" class="feed-state">
                <Loader2 class="animate-spin" :size="22" />
              </div>
              <template v-else-if="profile">
                <div class="profile-identity">
                  <div class="me-avatar profile-avatar">
                    <UserRound :size="26" />
                  </div>
                  <div>
                    <p class="profile-name">{{ profile.user.displayName }}</p>
                    <p v-if="profile.user.title" class="me-title">{{ profile.user.title }}</p>
                    <p v-if="profile.user.joinedAt" class="profile-joined">
                      {{ t.joinedAt }} {{ formatDate(profile.user.joinedAt) }}
                    </p>
                  </div>
                </div>

                <div class="profile-stats">
                  <div>
                    <span class="me-stat-value">{{ profile.stats.posts }}</span>
                    <span class="me-stat-label">{{ t.postCount }}</span>
                  </div>
                  <div>
                    <span class="me-stat-value">{{ profile.stats.comments }}</span>
                    <span class="me-stat-label">{{ t.commentCount }}</span>
                  </div>
                </div>

                <div v-if="profile.user && !profile.isSelf" class="profile-actions">
                  <BlockButton :user-id="profile.user.id" :display-name="profile.user.displayName" @done="onBlockDone" />
                  <button class="ghost-button" type="button" @click="openReport('USER', profile.user.id, profile.user.displayName)">
                    <Flag :size="14" />
                    <span>{{ t.report || '举报' }}</span>
                  </button>
                </div>

                <UserAchievement v-if="profile.user?.id" :user-id="profile.user.id" />

                <section class="profile-section">
                  <h4>{{ t.favoriteSong }}</h4>
                  <div v-if="profile.favoriteSong" class="song-row">
                    <div class="song-cover">
                      <img
                        v-if="profile.favoriteSong.cover"
                        :alt="profile.favoriteSong.title"
                        :src="profile.favoriteSong.cover"
                      >
                      <Music v-else :size="18" />
                    </div>
                    <div class="song-info">
                      <span class="song-title">{{ profile.favoriteSong.title }}</span>
                      <span class="song-artist">{{ profile.favoriteSong.artist }}</span>
                    </div>
                  </div>
                  <p v-else class="muted-text">{{ t.notPublic }}</p>
                </section>

                <section class="profile-section">
                  <h4>{{ t.likedSongs }}</h4>
                  <div v-if="profile.likedSongs && profile.likedSongs.length" class="liked-list">
                    <div v-for="song in profile.likedSongs" :key="song.id" class="liked-item">
                      <div class="song-cover liked-cover">
                        <img v-if="song.cover" :alt="song.title" :src="song.cover">
                        <Music v-else :size="14" />
                      </div>
                      <span class="song-title">{{ song.title }}</span>
                      <span class="song-artist">{{ song.artist }}</span>
                    </div>
                  </div>
                  <p v-else-if="profile.likedSongs" class="muted-text">{{ t.noLikedSongs }}</p>
                  <p v-else class="muted-text">{{ t.notPublic }}</p>
                </section>

                <button v-if="profile.isSelf" class="ghost-button profile-account-link" type="button" @click="goAccount">
                  <span>{{ t.accountEntry }}</span>
                  <ArrowRight :size="14" />
                </button>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 图片预览 -->
    <Teleport to="body">
      <Transition name="community-fade">
        <div v-if="lightbox.open" class="lightbox" @click.self="closeLightbox">
          <button class="lightbox-close" type="button" @click="closeLightbox">
            <X :size="22" />
          </button>
          <button
            v-if="lightbox.images.length > 1"
            class="lightbox-nav lightbox-prev"
            type="button"
            @click.stop="stepLightbox(-1)"
          >
            <ChevronLeft :size="24" />
          </button>
          <img :alt="`图片 ${lightbox.index + 1}`" :src="lightbox.images[lightbox.index]?.url">
          <button
            v-if="lightbox.images.length > 1"
            class="lightbox-nav lightbox-next"
            type="button"
            @click.stop="stepLightbox(1)"
          >
            <ChevronRight :size="24" />
          </button>
          <span v-if="lightbox.images.length > 1" class="lightbox-counter">
            {{ lightbox.index + 1 }} / {{ lightbox.images.length }}
          </span>
        </div>
      </Transition>
    </Teleport>

    <!-- 点赞署名选择：匿名 or 署名 -->
    <Teleport to="body">
      <Transition name="community-fade">
        <div v-if="pendingLikePost" class="modal-layer" @click.self="cancelLikeReveal">
          <div class="modal-card" style="max-width: 24rem">
            <header class="modal-head">
              <div>
                <h3>{{ uiT.voteReveal.title }}</h3>
                <p>{{ uiT.voteReveal.desc }}</p>
              </div>
              <button class="icon-button" type="button" @click="cancelLikeReveal">
                <X :size="18" />
              </button>
            </header>
            <div class="modal-body">
              <button
                class="w-full rounded-xl border px-3 py-2.5 text-left transition-all"
                :class="pendingRevealChoice === 'ANONYMOUS' ? 'border-primary bg-primary-10' : 'border-border-secondary hover:bg-bg-tertiary'"
                type="button"
                @click="pendingRevealChoice = 'ANONYMOUS'"
              >
                <p class="text-xs font-bold text-text-primary">{{ uiT.voteReveal.anonymous }}</p>
                <p class="mt-0.5 text-[10px] text-text-tertiary">{{ uiT.voteReveal.anonymousHint }}</p>
              </button>
              <button
                class="w-full rounded-xl border px-3 py-2.5 text-left transition-all"
                :class="pendingRevealChoice === 'REVEAL' ? 'border-primary bg-primary-10' : 'border-border-secondary hover:bg-bg-tertiary'"
                type="button"
                @click="pendingRevealChoice = 'REVEAL'"
              >
                <p class="text-xs font-bold text-text-primary">{{ uiT.voteReveal.reveal }}</p>
                <p class="mt-0.5 text-[10px] text-text-tertiary">{{ uiT.voteReveal.revealHint }}</p>
              </button>
              <label class="flex items-start gap-2 rounded-xl bg-bg-secondary-60 px-3 py-2 text-[11px] text-text-secondary">
                <input v-model="pendingRememberChoice" class="mt-0.5 h-3.5 w-3.5 accent-[var(--primary)]" type="checkbox" >
                <span class="min-w-0">
                  <span class="block font-bold">{{ uiT.voteReveal.remember }}</span>
                  <span class="mt-0.5 block text-text-tertiary">{{ uiT.voteReveal.rememberHint }}</span>
                </span>
              </label>
            </div>
            <footer class="modal-foot">
              <span class="foot-hint">{{ uiT.voteReveal.desc }}</span>
              <div class="foot-actions">
                <button class="ghost-button" type="button" @click="cancelLikeReveal">
                  {{ uiT.voteReveal.cancel }}
                </button>
                <button class="primary-button" type="button" @click="confirmLikeReveal">
                  {{ uiT.voteReveal.confirm }}
                </button>
              </div>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <ReportDialog
      v-model:show="reportState.show"
      :target-type="reportState.targetType"
      :target-id="reportState.targetId"
      :target-label="reportState.targetLabel"
      @done="onReportDone"
    />

    <ConfirmDialog
      v-model:show="removeConfirm.show"
      :title="removeConfirm.title"
      :message="removeConfirm.message"
      :type="'danger'"
      :loading="removeConfirm.loading"
      :show-input="removeConfirm.isDelete"
  :input-required="false"
      :input-placeholder="t.removeReasonPlaceholder"
      @confirm="runRemove"
      @cancel="removeConfirm.show = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  Heart,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  MessageCircle,
  Music,
  Pin,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
  X
} from '@lucide/vue'
import ConfirmDialog from '~/components/UI/ConfirmDialog.vue'
import ReportDialog from '~/components/Community/ReportDialog.vue'
import BlockButton from '~/components/Community/BlockButton.vue'
import NotificationCenter from '~/components/Notifications/NotificationCenter.vue'
import NowPlayingCard from '~/components/Community/NowPlayingCard.vue'
import UserAchievement from '~/components/Community/UserAchievement.vue'
import { useLocale } from '~/utils/locale'
import { useNewUi } from '~/composables/useNewUi'
import { useToast } from '~/composables/useToast'
import {
  COMMUNITY_IMAGE_MAX_UPLOAD_BYTES,
  compressCommunityImageFile,
  isCommunityImageType
} from '~/utils/communityImage'

type AnyRecord = Record<string, any>

const { community: communityLocale, currentLocale } = useLocale()
const t = computed<AnyRecord>(() => communityLocale.value || {})
const uiT = useNewUi()
const { showToast } = useToast()

const loading = ref(true)
const fatalError = ref('')
const status = ref<AnyRecord | null>(null)
const me = ref<AnyRecord | null>(null)
const boards = ref<AnyRecord[]>([])
const posts = ref<AnyRecord[]>([])
const activeBoardId = ref(0)
const filterMine = ref(false)
const feedLoading = ref(false)
const nextCursor = ref<number | null>(null)
const feedPermissions = reactive({ canPin: false })
const searchQuery = ref('')
const sortMode = ref<'latest' | 'hot'>('latest')
let searchTimer: ReturnType<typeof setTimeout> | null = null

const settings = computed<AnyRecord>(
  () =>
    status.value?.settings || {
      enabled: false,
      allowImages: false,
      maxImages: 9,
      maxContentLength: 1000,
      maxCommentLength: 300
    }
)
const canReview = computed(() => !!status.value?.viewer?.canReview)
const isOpen = computed(() => !!settings.value.enabled || canReview.value)
const ban = computed<AnyRecord>(
  () => status.value?.viewer?.ban || { muted: false, permanent: false, until: null, reason: null }
)
const violationCount = computed(() => Number(status.value?.viewer?.violationCount || 0))
const activeBoards = computed(() => boards.value.filter((board) => board.isActive))
const maxImages = computed(() => Math.min(Number(settings.value.maxImages || 9), 9))
const myUserId = computed(() => Number(me.value?.user?.id || 0))

function isOwnPost(post: AnyRecord | null) {
  return !!post && Number(post.author?.id) === myUserId.value && myUserId.value > 0
}

function isOwnComment(comment: AnyRecord | null) {
  return !!comment && Number(comment.author?.id) === myUserId.value && myUserId.value > 0
}

const reportState = reactive<{
  show: boolean
  targetType: 'POST' | 'COMMENT' | 'USER'
  targetId: number
  targetLabel: string
}>({ show: false, targetType: 'POST', targetId: 0, targetLabel: '' })

function openReport(targetType: 'POST' | 'COMMENT' | 'USER', targetId: number, label?: string) {
  reportState.targetType = targetType
  reportState.targetId = Number(targetId)
  reportState.targetLabel = String(label || '').slice(0, 40)
  reportState.show = true
}

function onReportDone() {
  showToast(t.value.reportSuccess || '举报已提交，等待管理员处理', 'success')
}

function onBlockDone() {
  showToast(t.value.blockSuccess || '已更新拉黑状态', 'success')
}

function canRemovePost(post: AnyRecord | null) {
  if (!post) return false
  return isOwnPost(post) || canReview.value
}

function canRemoveComment(comment: AnyRecord | null) {
  if (!comment) return false
  return isOwnComment(comment) || canReview.value
}

const publishOpen = ref(false)
const submitting = ref(false)
const imageInput = ref<HTMLInputElement | null>(null)
const uploading = ref(0)
const publishForm = reactive<AnyRecord>({
  boardId: 0,
  content: '',
  song: null as AnyRecord | null,
  images: [] as AnyRecord[]
})
const canSubmit = computed(
  () =>
    !!publishForm.boardId &&
    !!publishForm.content.trim() &&
    publishForm.content.length <= settings.value.maxContentLength
)

const songQuery = ref('')
const songResults = ref<AnyRecord[]>([])
const songSearched = ref(false)
let songTimer: ReturnType<typeof setTimeout> | null = null
let songSearchSeq = 0

const detailOpen = ref(false)
const selectedPost = ref<AnyRecord | null>(null)
const comments = ref<AnyRecord[]>([])
const threads = ref<AnyRecord[]>([])
const commentsLoading = ref(false)
const commentContent = ref('')
const sendingComment = ref(false)
const replyTo = ref<AnyRecord | null>(null)
const mentionHint = computed(() => Boolean(t.value.mentionHint))

const voteRevealMode = ref('ASK')
const pendingLikePost = ref<AnyRecord | null>(null)
const pendingRevealChoice = ref('ANONYMOUS')
const pendingRememberChoice = ref(false)

const profileOpen = ref(false)
const profileLoading = ref(false)
const profile = ref<AnyRecord | null>(null)

const lightbox = reactive<{ open: boolean; images: AnyRecord[]; index: number }>({
  open: false,
  images: [],
  index: 0
})

const removeConfirm = reactive({
  show: false,
  loading: false,
  title: '',
  message: '',
  isDelete: false,
  kind: '' as 'post' | 'comment' | '',
  target: null as AnyRecord | null
})

function apiMessage(error: any, fallback: string) {
  return (
    error?.data?.message ||
    error?.data?.statusMessage ||
    error?.statusMessage ||
    error?.message ||
    fallback
  )
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(currentLocale.value || 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function formatTime(value: string | Date | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return t.value.timeJustNow || '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)}${t.value.timeMinutes || '分钟前'}`
  if (diff < day) return `${Math.floor(diff / hour)}${t.value.timeHours || '小时前'}`
  if (diff < 7 * day) return `${Math.floor(diff / day)}${t.value.timeDays || '天前'}`
  return formatDate(date)
}

function statusText(value: string) {
  const map: Record<string, string> = {
    PENDING: t.value.statusPending,
    APPROVED: t.value.statusApproved,
    REJECTED: t.value.statusRejected,
    BLOCKED: t.value.statusBlocked
  }
  return map[value] || value
}

async function init() {
  loading.value = true
  fatalError.value = ''
  try {
    const [statusRes, meRes] = await Promise.all([
      $fetch<AnyRecord>('/api/community/status'),
      $fetch<AnyRecord>('/api/community/me')
    ])
    status.value = statusRes
    me.value = meRes
    void loadVoteRevealMode()
    if (!isOpen.value) return
    const boardsRes = await $fetch<AnyRecord>('/api/community/boards')
    boards.value = boardsRes.boards || []
    await loadFeed(true)
  } catch (error: any) {
    fatalError.value = apiMessage(error, t.value.loadFailed)
  } finally {
    loading.value = false
  }
}

async function loadFeed(reset = false) {
  if (feedLoading.value) return
  if (reset) {
    posts.value = []
    nextCursor.value = null
  }
  feedLoading.value = true
  try {
    const query: AnyRecord = { limit: 20, sort: sortMode.value }
    if (activeBoardId.value) query.boardId = activeBoardId.value
    if (filterMine.value) query.mine = '1'
    if (searchQuery.value.trim()) query.q = searchQuery.value.trim()
    if (!reset && nextCursor.value && sortMode.value === 'latest') query.beforeId = nextCursor.value
    const res = await $fetch<AnyRecord>('/api/community/posts', { query })
    const list = (res.posts || []) as AnyRecord[]
    posts.value = reset ? list : [...posts.value, ...list]
    nextCursor.value = res.nextCursor ?? null
    feedPermissions.canPin = Boolean(res.permissions?.canPin)
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    feedLoading.value = false
  }
}

function selectBoard(boardId: number) {
  if (activeBoardId.value === boardId) return
  activeBoardId.value = boardId
  loadFeed(true)
}

function toggleMine() {
  filterMine.value = !filterMine.value
  loadFeed(true)
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadFeed(true), 350)
}

function setSort(mode: 'latest' | 'hot') {
  if (sortMode.value === mode) return
  sortMode.value = mode
  loadFeed(true)
}

/** 帖子点赞（与歌曲点赞独立） */
async function togglePostLike(post: AnyRecord) {
  if (!post?.id || post.liking) return
  post.liking = true
  try {
    const res = await $fetch<AnyRecord>(`/api/community/posts/${post.id}/like`, { method: 'POST' })
    post.likedByMe = Boolean(res.liked)
    post.likeCount = Number(res.likeCount || 0)
    if (selectedPost.value?.id === post.id) {
      selectedPost.value.likedByMe = post.likedByMe
      selectedPost.value.likeCount = post.likeCount
    }
  } catch (error: any) {
    showToast(apiMessage(error, t.value.likeFailed), 'error')
  } finally {
    post.liking = false
  }
}

/** 管理员置顶/取消置顶 */
async function togglePin(post: AnyRecord) {
  if (!post?.id) return
  try {
    const res = await $fetch<AnyRecord>(`/api/admin/community/posts/${post.id}/pin`, {
      method: 'POST',
      body: { pinned: !post.pinned }
    })
    post.pinned = Boolean(res.pinned)
    if (selectedPost.value?.id === post.id) selectedPost.value.pinned = post.pinned
    showToast(post.pinned ? t.value.pinSuccess : t.value.unpinSuccess, 'success')
    await loadFeed(true)
  } catch (error: any) {
    showToast(apiMessage(error, t.value.likeFailed), 'error')
  }
}

const LIKE_BLOCK_KEYS: Record<string, string> = {
  NO_ACTIVE_SEMESTER: 'likeBlockedNoActiveSemester',
  INACTIVE_SEMESTER: 'likeBlockedInactiveSemester',
  PLAYED: 'likeBlockedPlayed',
  SCHEDULED: 'likeBlockedScheduled',
  SELF: 'likeBlockedSelf'
}

function songBlockedText(song: AnyRecord | null): string {
  if (!song) return ''
  if (song.likedByMe && song.canUnvote) return ''
  if (!song.likedByMe && song.canLike) return ''
  const key = song.likeBlockedCode ? LIKE_BLOCK_KEYS[song.likeBlockedCode] : ''
  return (key ? t.value[key] : '') || song.likeBlockedReason || t.value.likeUnavailable || ''
}

function likeBlockedText(post: AnyRecord | null): string {
  return songBlockedText(post?.song)
}

function canToggleLike(post: AnyRecord | null): boolean {
  const song = post?.song
  if (!song) return false
  return song.likedByMe ? !!song.canUnvote : !!song.canLike
}

function likeButtonTitle(post: AnyRecord | null): string {
  if (!post?.song) return ''
  if (post.liking) return t.value.likePending || ''
  return likeBlockedText(post) || (post.song.likedByMe ? t.value.unlike : t.value.like)
}

function applyLikeState(songId: number, liked: boolean, voteCount: number) {
  const update = (post: AnyRecord | null) => {
    if (!post?.song || post.song.id !== songId) return
    post.song.likedByMe = liked
    post.song.voteCount = Math.max(0, voteCount)
    post.song.canLike = !liked
    post.song.canUnvote = liked
    post.song.likeBlockedCode = null
    post.song.likeBlockedReason = null
  }
  posts.value.forEach(update)
  update(selectedPost.value)
}

async function loadVoteRevealMode() {
  try {
    const res = await $fetch<AnyRecord>('/api/user/vote-reveal')
    const mode = res?.data?.voteRevealMode
    if (mode === 'ANONYMOUS' || mode === 'REVEAL' || mode === 'ASK') voteRevealMode.value = mode
  } catch {
    // 读取偏好失败时回落到每次询问
  }
}

async function submitVote(post: AnyRecord, reveal: boolean) {
  if (!post?.song || post.liking) return
  const songId = Number(post.song.id)
  const unvote = !!post.song.likedByMe
  post.liking = true
  try {
    // 与 VoiceHub 点歌页共用 /api/songs/vote，热度写回同一张 Vote 表
    const res = await $fetch<AnyRecord>('/api/songs/vote', {
      method: 'POST',
      body: { songId, unvote, revealToRequester: unvote ? false : reveal === true }
    })
    const count = Number(res?.song?.voteCount ?? post.song.voteCount + (unvote ? -1 : 1))
    applyLikeState(songId, !unvote, count)
  } catch (error: any) {
    showToast(apiMessage(error, t.value.likeFailed), 'error')
  } finally {
    post.liking = false
  }
}

function cancelLikeReveal() {
  pendingLikePost.value = null
}

async function confirmLikeReveal() {
  const post = pendingLikePost.value
  if (!post) return
  const reveal = pendingRevealChoice.value === 'REVEAL'
  pendingLikePost.value = null
  if (pendingRememberChoice.value) {
    try {
      await $fetch('/api/user/vote-reveal', {
        method: 'PUT',
        body: { voteRevealMode: reveal ? 'REVEAL' : 'ANONYMOUS' }
      })
      voteRevealMode.value = reveal ? 'REVEAL' : 'ANONYMOUS'
    } catch {
      showToast(uiT.value.voteReveal.saveFailed, 'error')
    }
  }
  await submitVote(post, reveal)
}

async function toggleLike(post: AnyRecord) {
  if (!post?.song || post.liking) return
  if (!canToggleLike(post)) {
    const reason = likeBlockedText(post)
    if (reason) showToast(reason, 'warning')
    return
  }

  // 取消点赞不需要询问署名
  if (post.song.likedByMe) {
    await submitVote(post, false)
    return
  }
  if (voteRevealMode.value === 'ANONYMOUS' || voteRevealMode.value === 'REVEAL') {
    await submitVote(post, voteRevealMode.value === 'REVEAL')
    return
  }

  pendingRevealChoice.value = 'ANONYMOUS'
  pendingRememberChoice.value = false
  pendingLikePost.value = post
}

function openPublish() {
  if (!settings.value.enabled) return
  if (ban.value.muted) {
    showToast(t.value.muted, 'warning')
    return
  }
  publishForm.boardId = activeBoardId.value || activeBoards.value[0]?.id || 0
  publishForm.content = ''
  publishForm.song = null
  publishForm.images = []
  songQuery.value = ''
  songResults.value = []
  songSearched.value = false
  publishOpen.value = true
}

function closePublish() {
  if (submitting.value) return
  publishOpen.value = false
}

function handleSongInput() {
  if (songTimer) clearTimeout(songTimer)
  const keyword = songQuery.value.trim()
  const seq = ++songSearchSeq
  if (!keyword) {
    songResults.value = []
    songSearched.value = false
    return
  }
  songTimer = setTimeout(async () => {
    try {
      const res = await $fetch<AnyRecord>('/api/community/songs', { query: { q: keyword } })
      if (seq !== songSearchSeq) return
      songResults.value = res.songs || []
    } catch {
      if (seq !== songSearchSeq) return
      songResults.value = []
    } finally {
      if (seq === songSearchSeq) songSearched.value = true
    }
  }, 300)
}

function chooseSong(song: AnyRecord) {
  publishForm.song = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    cover: song.cover,
    canLike: song.canLike,
    canUnvote: song.canUnvote,
    likedByMe: song.likedByMe,
    likeBlockedCode: song.likeBlockedCode,
    likeBlockedReason: song.likeBlockedReason
  }
  songQuery.value = ''
  songResults.value = []
  songSearched.value = false
}

async function handleImageSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  const remaining = maxImages.value - publishForm.images.length
  for (const file of files.slice(0, Math.max(remaining, 0))) {
    if (!isCommunityImageType(file.type)) {
      showToast(t.value.imageTypeUnsupported || '仅支持 PNG / JPEG / WebP / GIF', 'error')
      continue
    }
    if (file.size > COMMUNITY_IMAGE_MAX_UPLOAD_BYTES) {
      showToast(t.value.imageTooLarge || '图片原始文件不能超过 15MB', 'error')
      continue
    }
    uploading.value += 1
    try {
      const prepared = await compressCommunityImageFile(file)
      if (prepared.compressed) showToast(t.value.imageCompressed, 'info', 2500)
      const form = new FormData()
      form.append('file', prepared.file)
      const res = await $fetch<AnyRecord>('/api/community/media', { method: 'POST', body: form })
      if (res.compressed && !prepared.compressed) showToast(t.value.imageCompressed, 'info', 2500)
      publishForm.images.push({ id: res.id, url: res.url })
    } catch (error: any) {
      showToast(apiMessage(error, t.value.imageUploadFailed), 'error')
    } finally {
      uploading.value -= 1
    }
  }
}

function removeImage(imageId: number) {
  publishForm.images = publishForm.images.filter((image: AnyRecord) => image.id !== imageId)
}

async function submitPost() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  try {
    const res = await $fetch<AnyRecord>('/api/community/posts', {
      method: 'POST',
      body: {
        boardId: publishForm.boardId,
        content: publishForm.content,
        songId: publishForm.song?.id ?? null,
        imageIds: publishForm.images.map((image: AnyRecord) => image.id)
      }
    })
    publishOpen.value = false
    if (res.status === 'BLOCKED') {
      showToast(t.value.publishBlocked, 'error')
    } else {
      showToast(t.value.publishSuccess, 'success')
    }
    filterMine.value = true
    await loadFeed(true)
    me.value = await $fetch<AnyRecord>('/api/community/me').catch(() => me.value)
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    submitting.value = false
  }
}

function askRemovePost(post: AnyRecord) {
  const withdraw = isOwnPost(post) && !canReview.value
  Object.assign(removeConfirm, {
    show: true,
    loading: false,
    kind: 'post',
    target: post,
    isDelete: !withdraw,
    title: withdraw ? t.value.withdrawPostTitle : t.value.deletePostTitle,
    message: withdraw ? t.value.withdrawPostMsg : t.value.deletePostMsg
  })
}

function askRemoveComment(comment: AnyRecord) {
  const withdraw = isOwnComment(comment) && !canReview.value
  Object.assign(removeConfirm, {
    show: true,
    loading: false,
    kind: 'comment',
    target: comment,
    isDelete: !withdraw,
    title: withdraw ? t.value.withdrawCommentTitle : t.value.deleteCommentTitle,
    message: withdraw ? t.value.withdrawCommentMsg : t.value.deleteCommentMsg
  })
}

async function runRemove(reason?: string) {
  if (!removeConfirm.target || removeConfirm.loading) return
  removeConfirm.loading = true
  const { kind, target } = removeConfirm
  try {
    const url =
      kind === 'post' ? `/api/community/posts/${target.id}` : `/api/community/comments/${target.id}`
    await $fetch(url, {
      method: 'DELETE',
      body: { reason: String(reason || '').trim() }
    })
    showToast(removeConfirm.isDelete ? t.value.deleteSuccess : t.value.withdrawSuccess, 'success')
    removeConfirm.show = false
    if (kind === 'post') {
      if (selectedPost.value?.id === target.id) closeDetail()
      await loadFeed(true)
    } else {
      comments.value = comments.value.filter((item) => item.id !== target.id)
      if (selectedPost.value && target.status === 'APPROVED') {
        selectedPost.value.commentCount = Math.max(0, Number(selectedPost.value.commentCount || 0) - 1)
        const post = posts.value.find((item) => item.id === selectedPost.value?.id)
        if (post) post.commentCount = selectedPost.value.commentCount
      }
    }
    me.value = await $fetch<AnyRecord>('/api/community/me').catch(() => me.value)
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    removeConfirm.loading = false
  }
}

async function openDetail(post: AnyRecord) {
  selectedPost.value = { ...post }
  detailOpen.value = true
  comments.value = []
  commentContent.value = ''
  commentsLoading.value = true
  try {
    const [detailRes, commentRes] = await Promise.all([
      $fetch<AnyRecord>(`/api/community/posts/${post.id}`),
      $fetch<AnyRecord>(`/api/community/posts/${post.id}/comments`)
    ])
    selectedPost.value = detailRes.post
    comments.value = commentRes.comments || []
    threads.value = commentRes.threads || []
    const target = posts.value.find((item) => item.id === post.id)
    if (target && detailRes.post) {
      target.viewCount = detailRes.post.viewCount
      target.likeCount = detailRes.post.likeCount
      target.likedByMe = detailRes.post.likedByMe
      target.pinned = detailRes.post.pinned
    }
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    commentsLoading.value = false
  }
}

function closeDetail() {
  detailOpen.value = false
  selectedPost.value = null
  replyTo.value = null
}

function startReply(comment: AnyRecord) {
  replyTo.value = comment
}

function cancelReply() {
  replyTo.value = null
}

async function sendComment() {
  const content = commentContent.value.trim()
  if (!content || sendingComment.value || !selectedPost.value) return
  sendingComment.value = true
  try {
    const result = await $fetch<AnyRecord>(`/api/community/posts/${selectedPost.value.id}/comments`, {
      method: 'POST',
      body: {
        content,
        parentId: replyTo.value?.id ?? null
      }
    })
    commentContent.value = ''
    replyTo.value = null
    const approved = result?.status === 'APPROVED'
    if (approved) {
      selectedPost.value.commentCount = Number(selectedPost.value.commentCount || 0) + 1
      const post = posts.value.find((item) => item.id === selectedPost.value?.id)
      if (post) post.commentCount = selectedPost.value.commentCount
    }
    const res = await $fetch<AnyRecord>(`/api/community/posts/${selectedPost.value.id}/comments`)
    comments.value = res.comments || []
    threads.value = res.threads || []
    showToast(approved ? t.value.commentSuccess : t.value.commentPendingSuccess, 'success')
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
  } finally {
    sendingComment.value = false
  }
}

async function openProfile(userId: number) {
  if (!userId) return
  profileOpen.value = true
  profileLoading.value = true
  profile.value = null
  try {
    profile.value = await $fetch<AnyRecord>(`/api/community/users/${userId}`)
  } catch (error: any) {
    showToast(apiMessage(error, t.value.loadFailed), 'error')
    profileOpen.value = false
  } finally {
    profileLoading.value = false
  }
}

function closeProfile() {
  profileOpen.value = false
  profile.value = null
}

function openLightbox(images: AnyRecord[], index: number) {
  lightbox.images = images
  lightbox.index = index
  lightbox.open = true
}

function closeLightbox() {
  lightbox.open = false
}

function stepLightbox(step: number) {
  const total = lightbox.images.length
  if (!total) return
  lightbox.index = (lightbox.index + step + total) % total
}

function goReview() {
  navigateTo('/dashboard?tab=community-review')
}

function goAccount() {
  profileOpen.value = false
  navigateTo('/account')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (lightbox.open) {
    closeLightbox()
  } else if (profileOpen.value) {
    closeProfile()
  } else if (detailOpen.value) {
    closeDetail()
  } else if (publishOpen.value) {
    closePublish()
  }
}

onMounted(() => {
  init()
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  if (songTimer) clearTimeout(songTimer)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.community-shell {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  height: auto;
  min-height: 0;
  padding-right: 0.25rem;
}

.community-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.community-title {
  font-size: 1.55rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.community-subtitle {
  margin-top: 0.25rem;
  font-size: 0.78rem;
  color: var(--text-tertiary);
}

.community-head-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.primary-button,
.ghost-button,
.icon-button,
.link-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border-radius: 0.75rem;
  font-size: 0.78rem;
  font-weight: 800;
  transition: all 0.2s ease;
  cursor: pointer;
}

.primary-button {
  padding: 0.65rem 1.1rem;
  background: var(--color-accent);
  color: #fff;
  box-shadow: 0 8px 20px var(--color-accent-alpha-30);
}

.primary-button:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.ghost-button {
  padding: 0.6rem 1rem;
  background: var(--overlay-5);
  border: 1px solid var(--overlay-10);
  color: var(--text-secondary);
}

.ghost-button:hover:not(:disabled) {
  background: var(--overlay-10);
  color: var(--text-primary);
}

.primary-button:disabled,
.ghost-button:disabled,
.like-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-button {
  width: 2.2rem;
  height: 2.2rem;
  background: var(--overlay-5);
  color: var(--text-tertiary);
}

.icon-button:hover {
  background: var(--overlay-10);
  color: var(--text-primary);
}

.link-button {
  padding: 0.35rem 0.6rem;
  color: var(--color-accent);
  background: var(--color-accent-alpha-10);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 18rem;
  padding: 2rem;
  border: 1px dashed var(--overlay-15);
  border-radius: 1.25rem;
  color: var(--text-tertiary);
  text-align: center;
}

.state-card h3 {
  color: var(--text-primary);
  font-size: 1.05rem;
  font-weight: 800;
}

.mute-banner,
.closed-banner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.7rem 1rem;
  border-radius: 0.85rem;
  font-size: 0.78rem;
  font-weight: 600;
}

.mute-banner {
  background: var(--warning-light);
  border: 1px solid var(--warning-border);
  color: var(--warning);
}

.closed-banner {
  background: var(--info-light);
  border: 1px solid var(--info-border);
  color: var(--info);
}

.mute-extra {
  margin-left: 0.25rem;
  opacity: 0.9;
}

.board-rail {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  scrollbar-width: none;
}

.board-rail::-webkit-scrollbar {
  display: none;
}

.board-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex: 0 0 auto;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  background: var(--overlay-5);
  border: 1px solid var(--overlay-10);
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-weight: 700;
  transition: all 0.2s ease;
  cursor: pointer;
}

.board-chip:hover {
  color: var(--text-primary);
  background: var(--overlay-10);
}

.board-chip.active {
  background: var(--color-accent-alpha-15);
  border-color: var(--color-accent-alpha-40);
  color: var(--color-accent);
}

.board-chip.dimmed:not(.active) {
  opacity: 0.55;
}

.board-count {
  font-size: 0.62rem;
  opacity: 0.75;
}

.community-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16rem;
  gap: 1.25rem;
  align-items: start;
}

.community-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.feed-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 1.8rem;
}

.feed-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
  flex-wrap: wrap;
}

.feed-search {
  flex: 1;
  min-width: 10rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--overlay-10);
  color: var(--text-tertiary);
}

.feed-search input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.72rem;
}

.feed-sort {
  display: inline-flex;
  border: 1px solid var(--overlay-10);
  border-radius: 999px;
  overflow: hidden;
}

.feed-sort button {
  padding: 0.35rem 0.7rem;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
}

.feed-sort button.active {
  background: var(--color-accent-alpha-10);
  color: var(--color-accent);
}

.pinned-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin-right: 0.35rem;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: var(--color-accent-alpha-10);
  color: var(--color-accent);
  font-size: 0.6rem;
  font-weight: 800;
  vertical-align: middle;
}

.footer-static {
  cursor: default;
}

.footer-static:hover {
  color: var(--text-tertiary);
}

.footer-like.liked,
.footer-like.liked:hover {
  color: #f43f5e;
}

.profile-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.75rem;
  color: var(--text-tertiary);
}

.feed-hint {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-tertiary);
}

.mine-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--overlay-10);
  color: var(--text-tertiary);
  font-size: 0.7rem;
  font-weight: 700;
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mine-toggle.active {
  color: var(--color-accent);
  border-color: var(--color-accent-alpha-40);
  background: var(--color-accent-alpha-10);
}

/* 移动端点击后 :hover 会“粘住”，只在真正支持 hover 的设备上给悬停反馈 */
@media (hover: hover) {
  .mine-toggle:hover {
    color: var(--color-accent);
    border-color: var(--color-accent-alpha-40);
    background: var(--color-accent-alpha-10);
  }
}

.feed-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  min-height: 12rem;
  padding: 2rem;
  color: var(--text-tertiary);
  font-size: 0.8rem;
  text-align: center;
}

.feed-list {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.post-card {
  padding: 1.1rem 1.2rem;
  border-radius: 1.1rem;
  background: var(--panel-bg-elevated);
  border: 1px solid var(--overlay-6);
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.post-card:hover {
  border-color: var(--overlay-12);
}

.post-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.identity-name {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text-primary);
  transition: color 0.2s ease;
}

.identity:hover .identity-name {
  color: var(--color-accent);
}

.identity-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.identity-title {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--color-accent-alpha-12);
  color: var(--color-accent);
  font-size: 0.6rem;
  font-weight: 800;
}

.identity-board {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--overlay-6);
  color: var(--text-tertiary);
  font-size: 0.6rem;
  font-weight: 700;
}

.post-time {
  flex: 0 0 auto;
  font-size: 0.64rem;
  color: var(--text-quaternary);
}

.status-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.7rem;
  flex-wrap: wrap;
}

.status-pill {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.6rem;
  font-weight: 800;
  border: 1px solid transparent;
}

.status-pending {
  background: var(--warning-light);
  border-color: var(--warning-border);
  color: var(--warning);
}

.status-approved {
  background: var(--success-light);
  border-color: var(--success-border);
  color: var(--success);
}

.status-rejected,
.status-blocked {
  background: var(--error-light);
  border-color: var(--error-border);
  color: var(--error);
}

.status-note {
  font-size: 0.66rem;
  color: var(--text-tertiary);
}

.post-content {
  margin-top: 0.75rem;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 微信式九宫格：1 张单独展示，2/4 张两列，3 张及以上三列，统一正方形缩略图，避免占满屏幕 */
.post-images {
  display: grid;
  gap: 0.3rem;
  margin-top: 0.85rem;
  max-width: 21rem;
}

.post-images.images-1 {
  grid-template-columns: minmax(0, 1fr);
  max-width: 15rem;
}

.post-images.images-2,
.post-images.images-4 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.post-images.images-3,
.post-images.images-many {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.image-button {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  border-radius: 0.5rem;
  overflow: hidden;
  cursor: zoom-in;
  background: var(--overlay-5);
}

.image-button img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  aspect-ratio: 1 / 1;
  transition: transform 0.3s ease;
}

.post-images.images-1 .image-button img {
  aspect-ratio: 4 / 3;
}

.image-button:hover img {
  transform: scale(1.03);
}

.song-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-top: 0.85rem;
  padding: 0.6rem 0.7rem;
  border-radius: 0.9rem;
  background: var(--overlay-4);
  border: 1px solid var(--overlay-6);
}

.song-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 0.55rem;
  overflow: hidden;
  background: var(--overlay-8);
  color: var(--text-tertiary);
}

.song-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.song-info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}

.song-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.song-artist {
  font-size: 0.66rem;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.song-note {
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--warning);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.like-button {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--overlay-10);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.72rem;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s ease;
}

.like-button:hover {
  color: #f43f5e;
  border-color: var(--error-border);
}

.like-button.liked {
  color: #f43f5e;
  background: var(--error-light);
  border-color: var(--error-border);
}

.post-footer {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.75rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--overlay-4);
}

.footer-action {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  transition: color 0.2s ease;
}

.footer-action:hover {
  color: var(--color-accent);
}

.footer-danger {
  margin-left: auto;
  color: var(--text-quaternary);
}

.footer-danger:hover {
  color: var(--error);
}

.detail-head-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.detail-remove {
  padding: 0.4rem 0.7rem;
  font-size: 0.7rem;
}

.detail-remove:hover {
  color: var(--error);
  border-color: var(--error-border);
}

.load-more-row {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0 1rem;
}

.community-aside {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  position: sticky;
  top: 0;
}

.me-card,
.rules-card {
  padding: 1rem;
  border-radius: 1rem;
  background: var(--panel-bg-elevated);
  border: 1px solid var(--overlay-6);
}

.me-identity,
.profile-identity {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.me-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 999px;
  background: var(--color-accent-alpha-15);
  color: var(--color-accent);
  flex: 0 0 auto;
}

.me-name,
.profile-name {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text-primary);
  word-break: break-all;
}

.me-title {
  margin-top: 0.15rem;
  font-size: 0.62rem;
  font-weight: 800;
  color: var(--color-accent);
}

.me-stats,
.profile-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.9rem;
  padding: 0.7rem 0;
  border-top: 1px solid var(--overlay-4);
  border-bottom: 1px solid var(--overlay-4);
}

.me-stats > div,
.profile-stats > div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  text-align: center;
}

.me-stat-value {
  font-size: 1rem;
  font-weight: 900;
  color: var(--text-primary);
}

.me-stat-label {
  font-size: 0.6rem;
  font-weight: 700;
  color: var(--text-tertiary);
}

.me-violation {
  margin-top: 0.6rem;
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--warning);
}

.me-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.8rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.7rem;
  background: var(--overlay-5);
  color: var(--text-secondary);
  font-size: 0.7rem;
  font-weight: 700;
  transition: all 0.2s ease;
}

.me-link:hover {
  background: var(--color-accent-alpha-10);
  color: var(--color-accent);
}

.rules-card h3 {
  font-size: 0.72rem;
  font-weight: 900;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.rules-card p {
  font-size: 0.66rem;
  line-height: 1.7;
  color: var(--text-tertiary);
}

.rules-card p + p {
  margin-top: 0.35rem;
}

/* 弹层 */
.modal-layer {
  position: fixed;
  inset: 0;
  z-index: 1800;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: var(--bg-primary-80, rgba(0, 0, 0, 0.72));
  backdrop-filter: blur(6px);
}

.modal-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: min(86vh, 46rem);
  border-radius: 1.35rem;
  background: var(--panel-bg-dialog);
  border: 1px solid var(--overlay-10);
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.publish-card {
  max-width: 34rem;
}

.detail-card {
  max-width: 36rem;
}

.profile-card {
  max-width: 30rem;
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1.1rem 1.2rem;
  border-bottom: 1px solid var(--overlay-6);
}

.modal-head h3 {
  font-size: 1rem;
  font-weight: 900;
  color: var(--text-primary);
}

.modal-head p {
  margin-top: 0.2rem;
  font-size: 0.7rem;
  color: var(--text-tertiary);
}

.detail-head-main {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.1rem 1.2rem;
  overflow-y: auto;
}

.modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.9rem 1.2rem;
  border-top: 1px solid var(--overlay-6);
  background: var(--overlay-2);
}

.foot-hint {
  font-size: 0.64rem;
  color: var(--text-quaternary);
}

.foot-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.publish-as {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  border-radius: 0.7rem;
  background: var(--overlay-4);
  font-size: 0.7rem;
}

.publish-as-label {
  color: var(--text-tertiary);
}

.publish-as-name {
  font-weight: 800;
  color: var(--text-primary);
}

.board-picker {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.7rem;
  font-weight: 800;
  color: var(--text-secondary);
}

.field-title-extra {
  margin-left: auto;
  color: var(--text-quaternary);
  font-size: 0.64rem;
}

.field textarea {
  width: 100%;
  min-height: 7rem;
  resize: vertical;
  padding: 0.8rem 0.9rem;
  border-radius: 0.85rem;
  border: 1px solid var(--overlay-10);
  background: var(--overlay-4);
  color: var(--text-primary);
  font-size: 0.86rem;
  line-height: 1.6;
  outline: none;
  transition: border-color 0.2s ease;
}

.field textarea::placeholder {
  color: var(--text-quaternary);
}

.field textarea:focus {
  border-color: var(--color-accent-alpha-50);
}

.field-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.62rem;
  color: var(--text-quaternary);
}

.field-hint {
  font-size: 0.64rem;
  color: var(--text-quaternary);
}

.search-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid var(--overlay-10);
  background: var(--overlay-4);
  color: var(--text-tertiary);
}

.search-field input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.8rem;
}

.search-field input::placeholder {
  color: var(--text-quaternary);
}

.song-results {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 12rem;
  overflow-y: auto;
  padding: 0.35rem;
  border-radius: 0.75rem;
  border: 1px solid var(--overlay-8);
  background: var(--overlay-2);
}

.song-result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border-radius: 0.6rem;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 0.74rem;
  cursor: pointer;
  text-align: left;
}

.song-result:hover {
  background: var(--overlay-8);
}

.song-result-title {
  font-weight: 700;
  color: var(--text-primary);
}

.song-result-artist {
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.song-result-liked {
  flex: 0 0 auto;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: var(--error-light);
  color: #f43f5e;
  font-size: 0.58rem;
  font-weight: 800;
}

.song-result-own {
  flex: 0 0 auto;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: var(--overlay-8);
  color: var(--text-tertiary);
  font-size: 0.58rem;
  font-weight: 800;
}

.song-result-blocked {
  flex: 0 0 auto;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: var(--warning-light);
  color: var(--warning);
  font-size: 0.58rem;
  font-weight: 800;
}

.song-result-pick {
  margin-left: auto;
  color: var(--color-accent);
  font-weight: 800;
  flex: 0 0 auto;
}

.selected-song {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.6rem 0.7rem;
  border-radius: 0.8rem;
  border: 1px solid var(--color-accent-alpha-25);
  background: var(--color-accent-alpha-10);
}

.image-uploader {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.upload-thumb {
  position: relative;
  width: 4.4rem;
  height: 4.4rem;
  border-radius: 0.7rem;
  overflow: hidden;
  border: 1px solid var(--overlay-10);
}

.upload-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-remove {
  position: absolute;
  top: 0.2rem;
  right: 0.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 999px;
  border: none;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  cursor: pointer;
}

.upload-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  width: 4.4rem;
  height: 4.4rem;
  border-radius: 0.7rem;
  border: 1px dashed var(--overlay-20);
  background: var(--overlay-3);
  color: var(--text-tertiary);
  font-size: 0.58rem;
  font-weight: 700;
  cursor: pointer;
}

.upload-add:hover:not(:disabled) {
  border-color: var(--color-accent-alpha-50);
  color: var(--color-accent);
}

.hidden-input {
  display: none;
}

.muted-text {
  font-size: 0.72rem;
  color: var(--text-quaternary);
}

.detail-body {
  gap: 0.85rem;
}

.detail-identity {
  align-self: stretch;
}

.detail-content {
  font-size: 0.92rem;
}

.detail-note {
  padding: 0.6rem 0.75rem;
  border-radius: 0.7rem;
  background: var(--overlay-4);
  border-left: 3px solid var(--text-quaternary);
}

.detail-note span {
  font-size: 0.6rem;
  font-weight: 800;
  color: var(--text-tertiary);
}

.detail-note p {
  margin-top: 0.2rem;
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.comment-section {
  padding-top: 0.4rem;
  border-top: 1px solid var(--overlay-6);
}

.comment-section h4 {
  font-size: 0.72rem;
  font-weight: 900;
  color: var(--text-secondary);
  margin-bottom: 0.6rem;
}

.comment-empty {
  font-size: 0.72rem;
  color: var(--text-quaternary);
  padding: 0.8rem 0;
  text-align: center;
}

.comment-replies {
  margin-top: 0.6rem;
  padding-left: 0.75rem;
  border-left: 2px solid var(--overlay-8);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.comment-reply-item {
  background: var(--overlay-4);
  border-radius: 0.6rem;
  padding: 0.5rem 0.6rem;
}

.comment-reply-btn {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.68rem;
  font-weight: 700;
  cursor: pointer;
}

.comment-reply-btn:hover {
  color: var(--color-accent);
}

.reply-target {
  font-size: 0.62rem;
  color: var(--text-disabled);
}

.mention-name {
  color: var(--color-accent);
  font-weight: 700;
}

.reply-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  width: 100%;
  padding: 0.35rem 0.6rem;
  border-radius: 0.6rem;
  background: var(--color-accent-alpha-10);
  color: var(--color-accent);
  font-size: 0.68rem;
  font-weight: 700;
}

.reply-chip button {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
}

.mention-hint {
  margin-top: 0.35rem;
  font-size: 0.62rem;
  color: var(--text-disabled);
}

.comment-list {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  max-height: 16rem;
  overflow-y: auto;
}

.comment-item {
  padding: 0.6rem 0.7rem;
  border-radius: 0.75rem;
  background: var(--overlay-3);
}

.comment-item p {
  margin-top: 0.35rem;
  font-size: 0.76rem;
  line-height: 1.6;
  color: var(--text-secondary);
  word-break: break-word;
}

.comment-identity {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
}

.comment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.comment-tail {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.comment-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.45rem;
  border: none;
  background: transparent;
  color: var(--text-quaternary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.comment-remove:hover {
  color: var(--error);
  background: var(--error-light);
}

.comment-note {
  margin-top: 0.3rem;
  font-size: 0.66rem;
  color: var(--warning);
}

.comment-identity .identity-name {
  font-size: 0.7rem;
}

.comment-time {
  display: block;
  margin-top: 0.3rem;
  font-size: 0.6rem;
  color: var(--text-quaternary);
}

.comment-foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 1.2rem;
  border-top: 1px solid var(--overlay-6);
  background: var(--overlay-2);
}

.comment-input {
  flex: 1;
  min-width: 0;
  padding: 0.6rem 0.8rem;
  border-radius: 0.75rem;
  border: 1px solid var(--overlay-10);
  background: var(--overlay-4);
  color: var(--text-primary);
  font-size: 0.8rem;
  outline: none;
}

.comment-input::placeholder {
  color: var(--text-quaternary);
}

.comment-input:focus {
  border-color: var(--color-accent-alpha-50);
}

.comment-send {
  flex: 0 0 auto;
}

.profile-avatar {
  width: 3.4rem;
  height: 3.4rem;
}

.profile-joined {
  margin-top: 0.2rem;
  font-size: 0.64rem;
  color: var(--text-quaternary);
}

.profile-section {
  padding-top: 0.7rem;
  border-top: 1px solid var(--overlay-6);
}

.profile-section h4 {
  font-size: 0.7rem;
  font-weight: 900;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.liked-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 12rem;
  overflow-y: auto;
}

.liked-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.55rem;
  border-radius: 0.6rem;
  background: var(--overlay-3);
}

.liked-cover {
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 0.4rem;
}

.liked-item .song-artist {
  margin-left: auto;
}

.profile-account-link {
  align-self: flex-start;
}

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2.5rem;
  background: rgba(0, 0, 0, 0.9);
}

.lightbox img {
  max-width: min(92vw, 70rem);
  max-height: 86vh;
  object-fit: contain;
  border-radius: 0.6rem;
}

.lightbox-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
}

.lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
}

.lightbox-prev {
  left: 1rem;
}

.lightbox-next {
  right: 1rem;
}

.lightbox-counter {
  position: absolute;
  bottom: 1.2rem;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.75);
}

.community-fade-enter-active,
.community-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.community-fade-enter-from,
.community-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 1024px) {
  .community-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .community-aside {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .community-shell {
    padding-right: 0;
    gap: 1rem;
  }

  .community-title {
    font-size: 1.3rem;
  }

  .community-head {
    align-items: flex-start;
  }

  .community-head-actions {
    width: 100%;
  }

  .community-head-actions .primary-button {
    flex: 1;
  }

  .community-aside {
    grid-template-columns: minmax(0, 1fr);
  }

  .post-card {
    padding: 0.95rem 1rem;
  }

  .post-images {
    max-width: 100%;
  }

  .modal-layer {
    align-items: flex-end;
    padding: 0;
  }

  .modal-card {
    max-height: 92vh;
    border-radius: 1.35rem 1.35rem 0 0;
    border-bottom: none;
  }

  .publish-card,
  .detail-card,
  .profile-card {
    max-width: 100%;
  }

  .comment-list {
    max-height: 12rem;
  }

  .lightbox {
    padding: 1rem;
  }

  .lightbox-nav {
    width: 2.25rem;
    height: 2.25rem;
  }

  .lightbox-prev {
    left: 0.4rem;
  }

  .lightbox-next {
    right: 0.4rem;
  }
}

@media (max-width: 480px) {
  .modal-foot {
    flex-direction: column;
    align-items: stretch;
  }

  .foot-hint {
    text-align: center;
  }

  .foot-actions {
    margin-left: 0;
  }

  .foot-actions .primary-button {
    flex: 1;
  }

  .comment-foot {
    padding: 0.7rem;
  }

  .comment-send span {
    display: none;
  }
}
</style>
