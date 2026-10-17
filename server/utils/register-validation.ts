// Modified by YH-Chen on 2026-10-17
// 注册相关校验纯函数（本地注册与 OAuth 注册共用）

export const REMARK_MAX_LENGTH = 200

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0

/**
 * 真实姓名格式（2026-10-11 起本站要求「必须中文」）：
 *   - 2~20 个汉字（含扩展 A / 扩展 B 生僻字）
 *   - 允许用「·」或「•」连接的多段姓名（少数民族姓名，如 阿依古丽·买买提）
 * 不允许字母、数字、空格及其它符号。
 */
export const REAL_NAME_PATTERN =
  /^[\u3400-\u4dbf\u4e00-\u9fff\u{20000}-\u{2ebef}]{2,20}(?:[·•][\u3400-\u4dbf\u4e00-\u9fff\u{20000}-\u{2ebef}]{1,20})*$/u

export const validateRealName = (name: unknown): { code: string; message: string } | null => {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!value) {
    return { code: 'AUTH_NAME_REQUIRED', message: '请填写真实姓名' }
  }
  if (!REAL_NAME_PATTERN.test(value)) {
    return {
      code: 'AUTH_NAME_MUST_BE_CHINESE',
      message: '真实姓名只能填写中文（2~20 个字，少数民族姓名可用「·」分隔）'
    }
  }
  return null
}

/** 同名同班提示里展示的用户名线索：只露前两位，避免被用来枚举账号 */
export const maskUsernameForDuplicateHint = (username: unknown): string => {
  const value = typeof username === 'string' ? username.trim() : ''
  if (!value) return '***'
  if (value.length <= 2) return `${value.slice(0, 1)}***`
  return `${value.slice(0, 2)}***`
}

// 年级与班级必须成对填写，或全部留空
export const validateGradeClassPair = (
  grade: unknown,
  studentClass: unknown
): { code: string; message: string } | null => {
  if (hasText(grade) !== hasText(studentClass)) {
    return { code: 'AUTH_GRADE_CLASS_TOGETHER', message: '年级和班级需要同时选择，或全部留空' }
  }

  return null
}

// 站点开启"注册必须选择年级班级"时：年级或班级任一缺失即不满足必填要求
const isGradeClassMissing = (grade: unknown, studentClass: unknown): boolean => {
  return !hasText(grade) || !hasText(studentClass)
}

// 注册年级班级判定统一入口：必填开启时任一缺失即拒绝，否则要求成对填写或全部留空
export const resolveGradeClassError = (
  grade: unknown,
  studentClass: unknown,
  required = false
): { code: string; message: string } | null => {
  if (required && isGradeClassMissing(grade, studentClass)) {
    return { code: 'AUTH_GRADE_CLASS_REQUIRED', message: '注册时必须选择年级和班级' }
  }

  return validateGradeClassPair(grade, studentClass)
}
