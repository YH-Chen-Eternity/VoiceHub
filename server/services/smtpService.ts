/* Modified by YH-Chen-Eternity on 2026-10-23 */

// Modified by YH-Chen on 2026-10-17
import nodemailer from 'nodemailer'
import { db } from '~/drizzle/db'
import { emailTemplates, users } from '~/drizzle/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getSiteTitle } from '~~/server/utils/siteUtils'
import { formatIPForEmail } from '~~/server/utils/ip-utils'
import { getSystemSettingsCached } from '~~/server/utils/system-settings-helper'

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

const TRUSTED_HTML_TEMPLATE_KEYS = new Set(['contentBlock'])
const EMAIL_REQUEST_SOURCE_LABEL = 'This email was requested from:'

const escapeHtml = (value: unknown): string => {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character] ?? character)
}

const normalizeEmailActionUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined

  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

const normalizeEmailSubject = (value: unknown): string => {
  return String(value ?? '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .trim()
}

/**
 * SMTP邮件服务
 */
export class SmtpService {
  private static instance: SmtpService
  public transporter: nodemailer.Transporter | null = null
  public smtpConfig: any = null
  /** 基础邮件模板结构 */
  private baseTemplate = `
    <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; background: #f9f9f9; padding: 20px;">
      <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #333; margin: 0;">{{fromName}}</h1>
          <p style="color: #666; margin: 5px 0 0 0;">{{headerSubtitle}}</p>
        </div>
        
        {{#if title}}
        <h2 style="color: #333; margin-bottom: 20px;">{{title}}</h2>
        {{/if}}
        
        <div style="color: #555; line-height: 1.6; margin-bottom: 30px;">
          {{contentBlock}}
        </div>
        
        {{#if actionUrl}}
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{actionUrl}}" style="display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">{{actionText}}</a>
        </div>
        {{/if}}
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        
        <p style="color: #666; font-size: 12px; text-align: center;">
          此邮件由系统自动发送，请勿回复。<br>
          如有疑问，请联系管理员。{{#if ipAddress}}<br><br>This email was requested from: <span style="font-family: monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; color: #333; text-decoration: none; pointer-events: none;">{{ipAddress}}</span>{{/if}}
        </p>
      </div>
    </div>
  `

  /** 内容块模板 */
  private contentBlocks: Record<string, string> = {
    verification: `
      <p>您好，{{name}}！</p>
      <p>您正在验证邮箱：<strong>{{email}}</strong></p>
      <p>请在{{expiresInMinutes}}分钟内输入以下验证码完成验证：</p>
      <div style="text-align: center; margin: 20px 0;">
        <h2 style="letter-spacing: 4px; color: #007bff; background: #f8f9fa; padding: 15px; border-radius: 4px; display: inline-block;">{{code}}</h2>
      </div>
      <p style="color:#888">若非本人操作，请忽略本邮件。</p>
    `,
    generic: `
      <div style="white-space: pre-wrap;">{{message}}</div>
    `,
    songSelected: `
      <p>您投稿的歌曲《{{songTitle}}》已被安排播放。</p>
      <p>播放日期：<strong>{{playDate}}</strong></p>
      {{#if playTimeName}}
      <p>播出时段：<strong>{{playTimeName}}</strong>{{#if playTimeRange}}（{{playTimeRange}}）{{/if}}</p>
      {{/if}}
    `,
    songPlayed: `
      <p>您投稿的歌曲《{{songTitle}}》已播放。</p>
    `,
    replaySongSelected: `
      <p>您申请重播的歌曲《{{songTitle}}》已安排播放。</p>
      <p>播放日期：<strong>{{playDate}}</strong></p>
      {{#if playTimeName}}
      <p>播出时段：<strong>{{playTimeName}}</strong></p>
      {{/if}}
    `,
    songVoted: `
      <p>您投稿的歌曲《{{songTitle}}》获得了新的投票。</p>
      <p>当前共有 <strong>{{votesCount}}</strong> 个投票。</p>
    `,
    songRejected: `
      <p>您投稿的歌曲《{{songTitle}}》已被管理员驳回。</p>
      {{#if reason}}
      <p>驳回原因：<strong>{{reason}}</strong></p>
      {{/if}}
    `,
    collaborationInvite: `
      <p>用户 <strong>{{inviterName}}</strong> 邀请您共同投稿歌曲《{{songTitle}}》。</p>
    `,
    accountDeletionScheduled: `
      <p>您好 <strong>{{username}}</strong>，您的账号注销申请已受理。</p>
      <p>账号数据将<b>保留 {{graceDays}} 天</b>，计划清理时间：<strong>{{scheduledAt}}</strong>。</p>
      <p style="color: #c0392b;">在清理之前，只要<b>登录一次本站</b>即可自动撤销注销、恢复账号；逾期未登录，账号信息将被清理。</p>
      <p>如果这不是您本人的操作，请立即登录并修改密码。</p>
    `,
    accountDeletionCompleted: `
      <p>您好 <strong>{{username}}</strong>，您的账号已于 <strong>{{deletedAt}}</strong> 完成注销。</p>
      <p>账号信息（昵称、姓名、邮箱、密码、登录方式）已清理；您此前的投稿记录已转为「已注销用户」保留在歌曲列表中。</p>
      <p>如果这是误操作，请联系广播站管理员协助处理。</p>
    `,
    accountDeletionCancelled: `
      <p>您好 <strong>{{username}}</strong>，您的账号注销申请已撤销（{{cancelledAt}}），账号已恢复正常使用。</p>
      <p>本次撤销原因：{{reason}}。</p>
    `,
    accountLoginAlert: `
      <p>您好 <strong>{{username}}</strong>，您的账号刚刚在新位置登录。</p>
      <p>登录时间：<strong>{{time}}</strong><br>登录 IP：<strong>{{ip}}</strong>{{#if device}}<br>设备：{{device}}{{/if}}</p>
      <p style="color: #c0392b;"><b>如果不是本人操作</b>，请立即登录并修改密码；<b>如果是本人操作</b>，忽略本邮件即可。</p>
    `,
    accountLoginFailed: `
      <p>您好 <strong>{{username}}</strong>，您的账号在短时间内出现了多次密码错误的登录尝试。</p>
      <p>最近时间：<strong>{{time}}</strong><br>来源 IP：<strong>{{ip}}</strong><br>连续失败次数：<strong>{{failCount}}</strong></p>
      <p style="color: #c0392b;">如果<b>不是本人</b>在尝试登录，说明密码可能已泄露，请尽快通过「忘记密码」重置密码；如果是本人输错了，忽略本邮件即可。</p>
    `,
    passwordChanged: `
      <p>您好 <strong>{{username}}</strong>，您的账号密码已修改成功。</p>
      <p>修改时间：<strong>{{time}}</strong>{{#if ip}}<br>来源 IP：<strong>{{ip}}</strong>{{/if}}</p>
      <p style="color: #c0392b;">如果<b>不是本人操作</b>，请立即使用「忘记密码」重置密码并联系管理员。</p>
    `,
    passwordReset: `
      <p>您好 <strong>{{username}}</strong>，您的账号密码已通过邮箱重置成功。</p>
      <p>重置时间：<strong>{{time}}</strong>{{#if ip}}<br>来源 IP：<strong>{{ip}}</strong>{{/if}}</p>
      <p>如果<b>不是本人操作</b>，请尽快联系广播站管理员。</p>
    `,
    emailBound: `
      <p>您好 <strong>{{username}}</strong>，您的账号已成功绑定邮箱 <strong>{{email}}</strong>。</p>
      <p>绑定时间：<strong>{{time}}</strong></p>
      <p>此后你可以使用该邮箱找回密码、接收审核与注销通知。不是本人操作请立即联系管理员。</p>
    `,
    emailUnbound: `
      <p>您好 <strong>{{username}}</strong>，您的账号已解绑邮箱 <strong>{{oldEmail}}</strong>。</p>
      <p>操作时间：<strong>{{time}}</strong></p>
      <p>解绑后将无法通过邮箱找回密码，如需重新绑定请在「账号」页面操作。</p>
    `,
    twoFactorEnabled: `
      <p>您好 <strong>{{username}}</strong>，您的账号已<b>开启</b>两步验证（2FA）。</p>
      <p>操作时间：<strong>{{time}}</strong></p>
      <p>此后登录需要额外输入动态验证码。不是本人操作请立即联系管理员。</p>
    `,
    twoFactorDisabled: `
      <p>您好 <strong>{{username}}</strong>，您的账号已<b>关闭</b>两步验证（2FA）。</p>
      <p>操作时间：<strong>{{time}}</strong></p>
      <p style="color: #c0392b;">关闭后账号安全性会下降。不是本人操作请立即重新开启并修改密码。</p>
    `,
    passwordAdminReset: `
      <p>您好 <strong>{{username}}</strong>，管理员已为你的账号<b>重置密码</b>。</p>
      <p>操作时间：<strong>{{time}}</strong></p>
      <p>请使用管理员提供的新密码登录，并在登录后立即在「账号」页面修改为你自己的密码。</p>
    `,
    communityResonanceAwarded: `
      <p>恭喜你！你与 <strong>{{partnerName}}</strong> 达成双向投稿互赞，获得称号「<strong>{{titleName}}</strong>」。</p>
      <p>你点赞了 TA 投稿的 <strong>{{sentCount}}</strong> 首；TA 点赞了你投稿的 <strong>{{receivedCount}}</strong> 首。</p>
      <p>你点赞 TA 的歌曲：</p>
      <div style="white-space: pre-wrap; background: #f8f9fa; border-radius: 4px; padding: 12px;">{{sentSongList}}</div>
      <p>TA 点赞你的歌曲：</p>
      <div style="white-space: pre-wrap; background: #f8f9fa; border-radius: 4px; padding: 12px;">{{receivedSongList}}</div>
      <p>达成时间：<strong>{{achievedAt}}</strong></p>
      <p style="color: #888;">该记录仅你本人可见；对外仅展示你所佩戴的称号。</p>
    `
  }

  /** 模板配置 */
  private builtinTemplates: Record<
    string,
    {
      name: string
      subject: string
      contentType: string
      headerSubtitle: string
      actionText?: string
      /** 模板可用变量（后台模板界面统一展示用） */
      variables?: string[]
    }
  > = {
    'verification.code': {
      name: '邮箱验证码',
      subject: '邮箱验证码 | {{siteTitle}}',
      contentType: 'verification',
      headerSubtitle: '邮箱验证',
      variables: ['name', 'email', 'code', 'expiresInMinutes']
    },
    'verification.code.deletion': {
      name: '注销账号验证码',
      subject: '注销账号验证码 | {{siteTitle}}',
      contentType: 'verification',
      headerSubtitle: '注销账号验证',
      variables: ['name', 'email', 'code', 'expiresInMinutes']
    },
    'register': {
      name: '注册通知',
      subject: '{{title}} | {{siteTitle}}通知推送',
      contentType: 'generic',
      headerSubtitle: '注册通知'
    },
    'register-approved': {
      name: '注册审核通过',
      subject: '{{title}} | {{siteTitle}}通知推送',
      contentType: 'generic',
      headerSubtitle: '注册审核通知'
    },
    'register-rejected': {
      name: '注册审核拒绝',
      subject: '{{title}} | {{siteTitle}}通知推送',
      contentType: 'generic',
      headerSubtitle: '注册审核通知'
    },
    'notification.generic': {
      name: '通用通知',
      subject: '{{title}} | {{siteTitle}}通知推送',
      contentType: 'generic',
      headerSubtitle: '通知推送',
      actionText: '查看详情'
    },
    'community.resonance.awarded': {
      name: '回声社区：获得共鸣称号',
      subject: '获得「{{titleName}}」称号 | {{siteTitle}}通知推送',
      contentType: 'communityResonanceAwarded',
      headerSubtitle: '回声社区',
      variables: ['titleName', 'partnerName', 'sentCount', 'receivedCount', 'mutualCount', 'sentSongList', 'receivedSongList', 'achievedAt']
    },
    'notification.songSelected': {
      name: '歌曲被选中',
      subject: '收到新选中 | {{siteTitle}}通知推送',
      contentType: 'songSelected',
      headerSubtitle: '通知推送'
    },
    'notification.songPlayed': {
      name: '歌曲已播放',
      subject: '歌曲已播放 | {{siteTitle}}通知推送',
      contentType: 'songPlayed',
      headerSubtitle: '通知推送'
    },
    'notification.replaySongSelected': {
      name: '重播申请已安排',
      subject: '重播已安排 | {{siteTitle}}通知推送',
      contentType: 'replaySongSelected',
      headerSubtitle: '通知推送'
    },
    'notification.songVoted': {
      name: '收到新投票',
      subject: '收到新投票 | {{siteTitle}}通知推送',
      contentType: 'songVoted',
      headerSubtitle: '通知推送'
    },
    'notification.songRejected': {
      name: '歌曲被驳回',
      subject: '歌曲被驳回 | {{siteTitle}}通知推送',
      contentType: 'songRejected',
      headerSubtitle: '通知推送'
    },
    'notification.collaborationInvite': {
      name: '收到联合投稿邀请',
      subject: '收到联合投稿邀请 | {{siteTitle}}通知推送',
      contentType: 'collaborationInvite',
      headerSubtitle: '通知推送'
    },
    'account.deletion.scheduled': {
      name: '注销申请已受理',
      subject: '账号注销申请已受理 | {{siteTitle}}',
      contentType: 'accountDeletionScheduled',
      headerSubtitle: '账号注销',
      variables: ['username', 'graceDays', 'scheduledAt']
    },
    'account.deletion.completed': {
      name: '账号已注销',
      subject: '账号已完成注销 | {{siteTitle}}',
      contentType: 'accountDeletionCompleted',
      headerSubtitle: '账号注销',
      variables: ['username', 'deletedAt']
    },
    'account.deletion.cancelled': {
      name: '注销申请已撤销',
      subject: '账号注销已撤销 | {{siteTitle}}',
      contentType: 'accountDeletionCancelled',
      headerSubtitle: '账号注销',
      variables: ['username', 'reason', 'cancelledAt']
    },
    'account.login.alert': {
      name: '登录提醒（新登录）',
      subject: '账号登录提醒 | {{siteTitle}}',
      contentType: 'accountLoginAlert',
      headerSubtitle: '安全提醒',
      variables: ['username', 'time', 'ip', 'device']
    },
    'account.login.failed': {
      name: '登录失败提醒（密码错误）',
      subject: '账号登录失败提醒 | {{siteTitle}}',
      contentType: 'accountLoginFailed',
      headerSubtitle: '安全提醒',
      variables: ['username', 'time', 'ip', 'failCount']
    },
    'account.password.changed': {
      name: '密码修改成功',
      subject: '密码修改成功 | {{siteTitle}}',
      contentType: 'passwordChanged',
      headerSubtitle: '安全提醒',
      variables: ['username', 'time', 'ip']
    },
    'account.password.reset': {
      name: '密码重置成功',
      subject: '密码重置成功 | {{siteTitle}}',
      contentType: 'passwordReset',
      headerSubtitle: '安全提醒',
      variables: ['username', 'time', 'ip']
    },
    'account.email.bound': {
      name: '邮箱绑定成功',
      subject: '邮箱绑定成功 | {{siteTitle}}',
      contentType: 'emailBound',
      headerSubtitle: '安全提醒',
      variables: ['username', 'email', 'time']
    },
    'account.email.unbound': {
      name: '邮箱解绑通知',
      subject: '邮箱已解绑 | {{siteTitle}}',
      contentType: 'emailUnbound',
      headerSubtitle: '安全提醒',
      variables: ['username', 'oldEmail', 'time']
    },
    'account.2fa.enabled': {
      name: '两步验证已开启',
      subject: '两步验证已开启 | {{siteTitle}}',
      contentType: 'twoFactorEnabled',
      headerSubtitle: '安全提醒',
      variables: ['username', 'time']
    },
    'account.2fa.disabled': {
      name: '两步验证已关闭',
      subject: '两步验证已关闭 | {{siteTitle}}',
      contentType: 'twoFactorDisabled',
      headerSubtitle: '安全提醒',
      variables: ['username', 'time']
    },
    'account.password.adminReset': {
      name: '密码被管理员重置',
      subject: '账号密码已被重置 | {{siteTitle}}',
      contentType: 'passwordAdminReset',
      headerSubtitle: '安全提醒',
      variables: ['username', 'time']
    }
  }

  private constructor() {}

  static getInstance(): SmtpService {
    if (!SmtpService.instance) {
      SmtpService.instance = new SmtpService()
      // 首次创建实例时，尝试初始化SMTP配置（异步执行，不阻塞）
      SmtpService.instance.initializeSmtpConfig().catch((error) => {
        console.log('SmtpService实例创建时初始化配置失败:', error.message)
      })
    }
    return SmtpService.instance
  }

  // 暴露内置模板（只读）
  getBuiltinTemplates(): Record<string, { name: string; subject: string; html: string }> {
    const templates: Record<string, { name: string; subject: string; html: string }> = {}

    for (const [key, config] of Object.entries(this.builtinTemplates)) {
      const contentBlock = this.contentBlocks[config.contentType] || ''
      const html = this.renderString(
        this.baseTemplate,
        {
          contentBlock,
          headerSubtitle: config.headerSubtitle,
          actionText: config.actionText || '查看详情'
        },
        { rawKeys: TRUSTED_HTML_TEMPLATE_KEYS }
      )

      templates[key] = {
        name: config.name,
        subject: config.subject,
        html
      }
    }

    return templates
  }

  /**
   * 初始化SMTP配置
   * 仅当配置为空或显式要求强制刷新时才执行
   */
  async initializeSmtpConfig(forceRefresh: boolean = false): Promise<boolean> {
    if (!forceRefresh && this.transporter) {
      return true
    }

    try {
      const settings = await getSystemSettingsCached()

      if (!settings || !settings.smtpEnabled || !settings.smtpHost) {
        this.smtpConfig = null
        this.transporter = null
        return false
      }

      const port = settings.smtpPort || 587
      const secure = settings.smtpSecure || false

      this.smtpConfig = {
        host: settings.smtpHost,
        port: port,
        secure: secure,
        auth:
          settings.smtpUsername && settings.smtpPassword
            ? {
                user: settings.smtpUsername,
                pass: settings.smtpPassword
              }
            : undefined,
        fromEmail: settings.smtpFromEmail || settings.smtpUsername,
        fromName: settings.smtpFromName || '校园广播站'
      }

      // 创建transporter配置
      const transporterConfig: any = {
        host: this.smtpConfig.host,
        port: this.smtpConfig.port,
        secure: this.smtpConfig.secure,
        auth: this.smtpConfig.auth
      }

      // 根据端口和安全设置调整配置
      const isDevelopment = process.env.NODE_ENV === 'development'

      if (port === 587 && !secure) {
        // STARTTLS - 端口587通常使用STARTTLS
        transporterConfig.requireTLS = true
        transporterConfig.tls = {
          // 仅在开发环境中跳过证书校验，生产环境必须校验
          rejectUnauthorized: !isDevelopment
        }
      } else if (port === 465) {
        // SSL/TLS - 端口465必须使用SSL
        transporterConfig.secure = true
      } else if (port === 25) {
        // 通常不加密
        transporterConfig.secure = false
        transporterConfig.tls = {
          // 仅在开发环境中跳过证书校验
          rejectUnauthorized: !isDevelopment
        }
      }

      // 创建transporter
      this.transporter = nodemailer.createTransport(transporterConfig)

      // 验证SMTP连接
      await this.transporter.verify()
      return true
    } catch (error: any) {
      console.error('初始化SMTP配置失败:', error instanceof Error ? error.message : '未知错误')
      this.smtpConfig = null
      this.transporter = null
      return false
    }
  }

  /**
   * 发送邮件
   */
  async sendMail(
    to: string,
    subject: string,
    htmlContent: string,
    textContent?: string,
    ipAddress?: string
  ): Promise<boolean> {
    // 确保配置已初始化
    if (!(await this.ensureInitialized())) {
      throw new Error('SMTP配置未初始化或无效')
    }

    // 兼容直接调用 sendMail 的邮件；模板已渲染来源 IP 时不重复追加
    let finalHtml = htmlContent
    if (ipAddress && !htmlContent.includes(EMAIL_REQUEST_SOURCE_LABEL)) {
      const formattedIP = escapeHtml(formatIPForEmail(ipAddress))
      finalHtml = htmlContent.replace(
        /(<p[^>]*style="[^"]*text-align: center[^"]*"[^>]*>.*?此邮件由系统自动发送，请勿回复。.*?<\/p>)/s,
        (footer) =>
          footer.replace(
            '此邮件由系统自动发送，请勿回复。',
            `此邮件由系统自动发送，请勿回复。<br><br>${EMAIL_REQUEST_SOURCE_LABEL} <span style="font-family: monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; color: #333; text-decoration: none; pointer-events: none;">${formattedIP}</span>`
          )
      )
    }

    const mailOptions = {
      from: {
        name: this.smtpConfig.fromName,
        address: this.smtpConfig.fromEmail
      },
      to,
      subject,
      html: finalHtml,
      text: textContent || finalHtml.replace(/<[^>]*>/g, '') // 简单的HTML转文本
    }

    this.lastSendFailure = null
    try {
      const result = await this.transporter!.sendMail(mailOptions)
      console.log(`邮件发送成功: ${result.messageId}`)
      return true
    } catch (error: any) {
      // 记下原始错误，供调用方判断"收件人不存在"这类永久失败（会直接提示学生邮箱写错了）
      this.lastSendFailure = {
        responseCode: Number(error?.responseCode || 0) || undefined,
        code: error?.code,
        message: error?.response || error?.message
      }
      // 自动重试机制：如果是因为发件人地址不匹配导致的553/501错误，尝试使用认证用户作为发件人
      if (
        (error.responseCode === 553 || error.responseCode === 501) &&
        this.smtpConfig.auth?.user
      ) {
        console.warn(
          `SMTP发件人地址不匹配 (${error.responseCode})，正在尝试使用认证用户重试发送...`
        )
        try {
          // 这里可以安全地使用 mailOptions，因为它在 try 块外部定义
          const retryMailOptions = {
            ...mailOptions,
            from: {
              ...mailOptions.from,
              address: this.smtpConfig.auth.user
            }
          }
          const result = await this.transporter!.sendMail(retryMailOptions)
          console.log(`重试发送成功: ${result.messageId}`)
          return true
        } catch (retryError: any) {
          console.error('重试发送失败:', retryError)
          throw error // 如果重试也失败，抛出原始错误
        }
      }

      console.error('发送邮件失败:', error)
      throw error
    }
  }

  /** 最近一次发信失败的原始信息（成功后被清空） */
  private lastSendFailure: { responseCode?: number; code?: string; message?: string } | null = null

  getLastSendFailure() {
    return this.lastSendFailure
  }

  /**
   * 渲染模板：优先使用自定义模板，否则回退到内置模板
   */
  async renderTemplate(
    key: string,
    data: Record<string, any>
  ): Promise<{ subject: string; html: string }> {
    const builtin = this.builtinTemplates[key]
    let subject = builtin?.subject || ''
    let html = ''

    try {
      const rows = await db
        .select()
        .from(emailTemplates)
        .where(eq(emailTemplates.key, key))
        .limit(1)
      const custom = rows[0]
      if (custom) {
        subject = custom.subject
        html = custom.html
      }
    } catch (e: any) {
      // 忽略读取失败，走内置
    }

    let mergedData: Record<string, any>

    // 如果没有自定义模板，使用内置模板系统
    if (!html && builtin) {
      mergedData = await this.prepareTemplateData(data)
      const contentBlock = this.renderString(
        this.contentBlocks[builtin.contentType] || '',
        mergedData
      )
      const templateData = {
        ...mergedData,
        contentBlock,
        headerSubtitle: builtin.headerSubtitle,
        actionText: builtin.actionText || '查看详情'
      }
      html = this.renderString(this.baseTemplate, templateData, {
        rawKeys: TRUSTED_HTML_TEMPLATE_KEYS
      })
    } else {
      mergedData = await this.prepareTemplateData(data)
      html = this.renderString(html, mergedData)
    }

    return {
      subject: normalizeEmailSubject(
        this.renderString(subject, mergedData, { escapeValues: false })
      ),
      html
    }
  }

  /**
   * 渲染并发送模板
   */
  async renderAndSend(
    to: string,
    key: string,
    data: Record<string, any>,
    ipAddress?: string
  ): Promise<boolean> {
    try {
      // 确保配置已初始化
      if (!(await this.ensureInitialized())) {
        return false
      }

      // 格式化IP地址用于模板渲染（统一处理）
      const formattedIP = ipAddress ? formatIPForEmail(ipAddress) : undefined
      const templateData = { ...data, ipAddress: formattedIP }

      const { subject, html } = await this.renderTemplate(key, templateData)
      if (!subject || !html) {
        // 若模板缺失，退回到简单包装（传入已格式化的IP）
        const mergedData = await this.prepareTemplateData(templateData)
        const fallbackHtml = this.generateEmailTemplate(
          data.title || data.fallbackTitle || '通知',
          data.message || data.fallbackMessage || '',
          data.actionUrl,
          formattedIP
        )
        const fallbackSubject = normalizeEmailSubject(
          `${data.title || data.fallbackTitle || '通知'} | ${mergedData.siteTitle}通知推送`
        )
        return await this.sendMail(to, fallbackSubject, fallbackHtml, undefined, ipAddress)
      }
      return await this.sendMail(to, subject, html, undefined, ipAddress)
    } catch (error: any) {
      console.error('渲染并发送邮件失败:', error)
      return false
    }
  }

  /**
   * 测试SMTP连接
   */
  async testConnection(): Promise<{ success: boolean; message: string; detail?: string }> {
    if (!this.transporter) {
      try {
        const initialized = await this.initializeSmtpConfig()
        if (!initialized) {
          return { success: false, message: 'SMTP配置无效或未启用' }
        }
      } catch (error: any) {
        return {
          success: false,
          message: '初始化SMTP配置失败',
          detail: error instanceof Error ? error.message : '未知错误'
        }
      }
    }

    try {
      await this.transporter!.verify()
      return { success: true, message: 'SMTP连接测试成功' }
    } catch (error: any) {
      return {
        success: false,
        message: 'SMTP连接测试失败',
        detail: error instanceof Error ? error.message : '未知错误'
      }
    }
  }

  /**
   * 发送测试邮件
   */
  async sendTestEmail(
    to: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string; detail?: string }> {
    try {
      const formattedIP = ipAddress ? formatIPForEmail(ipAddress) : undefined
      const templateData = await this.prepareTemplateData({ ipAddress: formattedIP })
      const subject = normalizeEmailSubject(`测试邮件 | ${templateData.siteTitle}通知推送`)
      const htmlContent = this.generateEmailTemplate(
        '测试邮件',
        '这是一封来自校园广播站系统的测试邮件。<br>如果您收到这封邮件，说明SMTP配置已经正确设置。',
        undefined,
        formattedIP,
        true
      )

      const success = await this.sendMail(to, subject, htmlContent, undefined, ipAddress)
      return {
        success,
        message: success ? '测试邮件发送成功' : '测试邮件发送失败'
      }
    } catch (error: any) {
      return {
        success: false,
        message: '测试邮件发送失败',
        detail: error instanceof Error ? error.message : '未知错误'
      }
    }
  }

  /**
   * 生成邮件HTML模板
   */
  generateEmailTemplate(
    title: string,
    content: string,
    actionUrl?: string,
    formattedIP?: string,
    trustedHtmlContent = false
  ): string {
    const safeFromName = escapeHtml(this.smtpConfig?.fromName || '校园广播站')
    const safeTitle = escapeHtml(title)
    const safeContent = trustedHtmlContent ? content : escapeHtml(content)
    const safeActionUrl = normalizeEmailActionUrl(actionUrl)
    const safeFormattedIP = formattedIP ? escapeHtml(formattedIP) : ''

    return `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; background: #f9f9f9; padding: 20px;">
        <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333; margin: 0;">${safeFromName}</h1>
            <p style="color: #666; margin: 5px 0 0 0;">通知推送</p>
          </div>
          
          <h2 style="color: #333; margin-bottom: 20px;">${safeTitle}</h2>
          
          <div style="color: #555; line-height: 1.6; margin-bottom: 30px; white-space: pre-wrap;">
            ${safeContent}
          </div>
          
          ${
            safeActionUrl
              ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${escapeHtml(safeActionUrl)}" style="display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">查看详情</a>
            </div>
          `
              : ''
          }
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="color: #666; font-size: 12px; text-align: center;">
            此邮件由系统自动发送，请勿回复。<br>
            如有疑问，请联系管理员。${safeFormattedIP ? `<br><br>This email was requested from: <span style="font-family: monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; color: #333; text-decoration: none; pointer-events: none;">${safeFormattedIP}</span>` : ''}
          </p>
        </div>
      </div>
    `
  }

  /**
   * 确保SMTP配置已初始化
   */
  private async ensureInitialized(): Promise<boolean> {
    if (!this.transporter) {
      return await this.initializeSmtpConfig()
    }
    return true
  }

  /**
   * 基本占位符渲染：用 {{var}} 替换，支持 {{#if var}}...{{/if}} 嵌套条件
   */
  private renderString(
    tpl: string,
    data: Record<string, any>,
    options: { escapeValues?: boolean; rawKeys?: ReadonlySet<string> } = {}
  ): string {
    // 递归处理嵌套的 if 块
    const processIfBlocks = (template: string): string => {
      let hasChanges = true
      let result = template

      while (hasChanges) {
        hasChanges = false
        // 从最内层开始处理，匹配不包含嵌套{{#if}}的if块
        result = result.replace(
          /\{\{#if\s+([a-zA-Z0-9_\.]+)\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{\/if\}\}/g,
          (match, key, inner) => {
            const v = key
              .split('.')
              .reduce((acc: any, k: string) => (acc ? acc[k] : undefined), data)
            hasChanges = true
            return v ? inner : ''
          }
        )
      }

      return result
    }

    // 处理所有if块
    tpl = processIfBlocks(tpl)

    // 处理变量
    tpl = tpl.replace(/\{\{\s*([a-zA-Z0-9_\.]+)\s*\}\}/g, (_, key) => {
      const v = key.split('.').reduce((acc: any, k: string) => (acc ? acc[k] : undefined), data)
      if (v == null) return ''

      const renderedValue = String(v)
      if (options.escapeValues === false || options.rawKeys?.has(key)) return renderedValue
      return escapeHtml(renderedValue)
    })

    return tpl
  }

  /**
   * 准备模板渲染数据
   */
  private async prepareTemplateData(data: Record<string, any>): Promise<Record<string, any>> {
    const siteTitle = await getSiteTitle()
    return {
      ...data,
      fromName: this.smtpConfig?.fromName || '校园广播站',
      siteTitle,
      actionUrl: normalizeEmailActionUrl(data.actionUrl)
    }
  }
}

/**
 * 发送邮件通知给用户
 */
export async function sendEmailNotificationToUser(
  userId: number,
  notificationTitle: string,
  notificationMessage: string,
  url?: string,
  templateKey?: string,
  templateData?: Record<string, any>,
  ipAddress?: string
): Promise<boolean> {
  try {
    const smtpService = SmtpService.getInstance()

    // 获取用户信息
    const userResult = await db
      .select({
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    const user = userResult[0]

    // 仅检查用户是否有邮箱且已验证
    if (!user?.email || !user.emailVerified) {
      return false
    }

    // 使用指定模板，否则回退通用模板
    if (templateKey) {
      return await smtpService.renderAndSend(
        user.email,
        templateKey,
        {
          fallbackTitle: notificationTitle,
          fallbackMessage: notificationMessage,
          message: notificationMessage,
          actionUrl: url,
          ...(templateData || {})
        },
        ipAddress
      )
    }
    return await smtpService.renderAndSend(
      user.email,
      'notification.generic',
      {
        title: notificationTitle,
        message: notificationMessage,
        actionUrl: url
      },
      ipAddress
    )
  } catch (error: any) {
    console.error('发送邮件通知失败:', error)
    return false
  }
}

/**
 * 批量发送邮件通知
 */
export async function sendBatchEmailNotifications(
  userIds: number[],
  notificationTitle: string,
  notificationMessage: string,
  url?: string,
  ipAddress?: string
): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0

  const smtpService = SmtpService.getInstance()

  // 获取有邮箱且已验证的用户
  const usersWithEmail = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email
    })
    .from(users)
    .where(and(eq(users.emailVerified, true), isNotNull(users.email)))

  // 并发发送邮件（限制并发数）
  const batchSize = 5
  const targetUsers = usersWithEmail.filter((user) => userIds.includes(user.id))

  for (let i = 0; i < targetUsers.length; i += batchSize) {
    const batch = targetUsers.slice(i, i + batchSize)
    const promises = batch.map(async (user) => {
      // 确保 email 不为 null
      if (!user.email) {
        return false
      }
      const emailSuccess = await smtpService.renderAndSend(
        user.email,
        'notification.generic',
        {
          title: notificationTitle,
          message: notificationMessage,
          actionUrl: url
        },
        ipAddress
      )
      return emailSuccess
    })

    const results = await Promise.allSettled(promises)
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        success++
      } else {
        failed++
      }
    })
  }

  return { success, failed }
}
