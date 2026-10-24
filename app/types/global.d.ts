// 全局类型声明文件

interface Window {
  $showNotification: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
  voiceHubPlayer?: {
    getPlayState?: () => any
    onPlayStateChanged?: (...args: any[]) => void
    onSongChanged?: (...args: any[]) => void
    updatePlaylistState?: (...args: any[]) => void
    updatePosition?: (...args: any[]) => void
    [key: string]: any
  }
}
