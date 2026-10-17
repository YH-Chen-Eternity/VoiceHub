export const _sig = [76, 97, 111, 83, 104, 117, 105]
export const _sys = [86, 111, 105, 99, 101, 72, 117, 98]
// 社区版：页脚链接指向本社区仓库（非上游仓库）
  export const _repo = [
    104,116,116,112,115,58,47,47,103,105,116,104,117,98,46,99,111,109,47,89,72,45,67,104,101,
    110,45,69,116,101,114,110,105,116,121,47,86,111,105,99,101,72,117,98,45,80,108,117,115
  ]

export const getCopyrightOwner = () => String.fromCharCode(..._sig)
export const getSystemName = () => String.fromCharCode(..._sys)
export const getRepoUrl = () => String.fromCharCode(..._repo)
