import { escapeHtml } from '../../common/utils/sanitize';
import { formatNaira } from '../../common/utils/money';

export const BRAND = {
  ink: '#06231A',
  forest: '#0B3D2E',
  forestSoft: '#E9F4EE',
  forestBorder: '#CFE8D9',
  orange: '#FF5A1F',
  orangeSoft: '#FFF2EC',
  orangeBorder: '#FFC2A8',
  cream: '#FBF7EF',
  yellow: '#F5D547',
  muted: '#5F6B64',
  mutedLight: '#8B948F',
  line: '#E7E1D5',
  cardBg: '#FFFFFF',
  danger: '#C92A2A',
  dangerSoft: '#FDF2F2',
  success: '#0B8A5A',
  white: '#FFFFFF',
};

export type BadgeTone = 'orange' | 'green' | 'gold' | 'danger' | 'neutral';

export interface EmailBadge {
  text: string;
  tone?: BadgeTone;
}

export interface EmailButton {
  label: string;
  url: string;
  secondary?: boolean;
}

export interface EmailLayoutOptions {
  title: string;
  preheader: string;
  badge?: EmailBadge;
  body: string;
  button?: EmailButton;
  secondaryButton?: EmailButton;
  footerNote?: string;
  businessName?: string;
}

function renderBadge(badge?: EmailBadge): string {
  if (!badge) return '';
  let bg = BRAND.orangeSoft;
  let text = BRAND.orange;
  let border = BRAND.orangeBorder;

  if (badge.tone === 'green') {
    bg = BRAND.forestSoft;
    text = BRAND.forest;
    border = BRAND.forestBorder;
  } else if (badge.tone === 'danger') {
    bg = BRAND.dangerSoft;
    text = BRAND.danger;
    border = '#F8B4B4';
  } else if (badge.tone === 'gold') {
    bg = '#FFFBEB';
    text = '#B45309';
    border = '#FDE68A';
  } else if (badge.tone === 'neutral') {
    bg = '#F3F4F6';
    text = '#4B5563';
    border = '#E5E7EB';
  }

  return `<div style="display:inline-block;padding:5px 12px;border-radius:20px;background-color:${bg};border:1px solid ${border};color:${text};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:14px;">${escapeHtml(badge.text)}</div>`;
}

export function emailLayout(opts: EmailLayoutOptions): string {
  const { title, preheader, badge, body, button, secondaryButton, footerNote } = opts;

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
<!--[if mso]>
<style>
  table { border-collapse: collapse; }
  *, text, td, a { font-family: Arial, sans-serif !important; }
</style>
<![endif]-->
<style>
  body { margin: 0; padding: 0; background-color: ${BRAND.cream}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'DM Sans', Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  img { border: 0; outline: none; text-decoration: none; display: block; }
  table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  td { vertical-align: top; }
  .email-container { max-width: 580px; width: 100%; margin: 0 auto; background-color: ${BRAND.white}; border-radius: 20px; overflow: hidden; border: 1px solid ${BRAND.line}; box-shadow: 0 4px 14px rgba(6,35,26,0.04); }
  .btn-primary { display: inline-block; background-color: ${BRAND.orange}; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 26px; border-radius: 12px; text-align: center; box-shadow: 0 2px 6px rgba(255,90,31,0.2); }
  .btn-secondary { display: inline-block; background-color: ${BRAND.cream}; color: ${BRAND.ink} !important; text-decoration: none; font-weight: 700; font-size: 14px; padding: 13px 22px; border-radius: 12px; border: 1px solid ${BRAND.line}; text-align: center; }
  @media only screen and (max-width: 600px) {
    .content-padding { padding: 28px 20px !important; }
    .header-padding { padding: 22px 20px !important; }
    .footer-padding { padding: 20px 20px !important; }
    .btn-primary, .btn-secondary { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
    .stat-table td { display: block !important; width: 100% !important; box-sizing: border-box !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.cream};color:${BRAND.ink};">

<!-- Hidden Preheader for Inbox Snippet -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#fff;opacity:0;">
  ${escapeHtml(preheader)} &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.cream};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" class="email-container" cellpadding="0" cellspacing="0">
        <!-- Header -->
        <tr>
          <td class="header-padding" style="background-color:${BRAND.ink};padding:26px 32px;border-bottom:3px solid ${BRAND.orange};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <a href="https://ojaly.ng" target="_blank" style="text-decoration:none;display:inline-flex;align-items:center;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background-color:${BRAND.orange};width:14px;height:14px;border-radius:4px;vertical-align:middle;"></td>
                        <td style="padding-left:10px;color:${BRAND.white};font-size:24px;font-weight:800;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk',Arial,sans-serif;vertical-align:middle;">
                          ojaly
                        </td>
                      </tr>
                    </table>
                  </a>
                  <div style="color:#A8C0B4;font-size:12px;font-weight:500;margin-top:4px;">Run your business. Own your numbers.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Main Body -->
        <tr>
          <td class="content-padding" style="padding:36px 32px 16px;background-color:${BRAND.white};">
            ${renderBadge(badge)}
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:800;line-height:1.2;letter-spacing:-0.6px;color:${BRAND.ink};font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk',Arial,sans-serif;">
              ${escapeHtml(title)}
            </h1>

            <div style="font-size:15px;line-height:1.65;color:#23322B;">
              ${body}
            </div>

            <!-- Action Buttons -->
            ${
              button || secondaryButton
                ? `<div style="margin:30px 0 10px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                      <tr>
                        <td>
                          ${button ? `<a href="${button.url}" target="_blank" class="btn-primary">${escapeHtml(button.label)} &rarr;</a>` : ''}
                          ${secondaryButton ? `<span style="display:inline-block;width:12px;height:1px;"></span><a href="${secondaryButton.url}" target="_blank" class="btn-secondary">${escapeHtml(secondaryButton.label)}</a>` : ''}
                        </td>
                      </tr>
                    </table>
                  </div>`
                : ''
            }
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td class="footer-padding" style="padding:24px 32px 32px;background-color:${BRAND.white};">
            <div style="border-top:1px solid ${BRAND.line};padding-top:20px;color:${BRAND.muted};font-size:13px;line-height:1.6;">
              ${footerNote ? `<p style="margin:0 0 12px;color:#3D4641;font-weight:500;">${footerNote}</p>` : ''}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
                <tr>
                  <td style="color:${BRAND.muted};font-size:12px;line-height:1.5;">
                    <strong style="color:${BRAND.ink};">Ojaly</strong> &middot; Empowering student & retail entrepreneurs across Nigeria.<br>
                    Need quick assistance? Reply directly to this email or chat on WhatsApp.
                  </td>
                </tr>
              </table>
            </div>
          </td>
        </tr>
      </table>

      <!-- Sub-footer Notice -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;margin-top:16px;">
        <tr>
          <td align="center" style="color:${BRAND.mutedLight};font-size:11px;line-height:1.5;">
            You received this notification because your business is registered on Ojaly.<br>
            Manage summary preferences in <strong>Settings &rarr; Summaries</strong>.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

// ─── TEMPLATES ─────────────────────────────────────────────────────────────

export function welcomeEmail(name: string, businessName: string, url: string): { subject: string; html: string } {
  const firstName = name.split(' ')[0] || 'there';
  return {
    subject: `Your business is live, ${firstName} 🚀`,
    html: emailLayout({
      title: `You're all set.`,
      preheader: `${businessName} is officially registered and live on Ojaly.`,
      badge: { text: 'Welcome aboard', tone: 'orange' },
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p><strong>${escapeHtml(businessName)}</strong> is now officially active on Ojaly. From today, every sale you record calculates your true gross profit, tracks what goods cost you, and watches customer debts automatically.</p>
      
      <div style="background-color:${BRAND.forestSoft};border-left:4px solid ${BRAND.forest};border-radius:12px;padding:16px 18px;margin:22px 0;">
        <div style="font-weight:700;color:${BRAND.forest};font-size:14px;">✨ Your free online storefront is ready</div>
        <div style="font-size:13px;color:#184232;margin-top:4px;">Add products with photos and prices &mdash; Ojaly generates a fast, shareable website link for your WhatsApp bio.</div>
      </div>

      <p style="font-weight:700;color:${BRAND.ink};margin:22px 0 10px;">Your first 3 steps to take control:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;margin-bottom:12px;">
        <tr>
          <td style="padding:8px 0;width:28px;vertical-align:top;"><span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:50%;background:${BRAND.ink};color:#fff;text-align:center;font-size:11px;font-weight:700;">1</span></td>
          <td style="padding:8px 0;vertical-align:top;"><strong>Add your products:</strong> Enter cost price and selling price so profit is exact.</td>
        </tr>
        <tr>
          <td style="padding:8px 0;width:28px;vertical-align:top;"><span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:50%;background:${BRAND.ink};color:#fff;text-align:center;font-size:11px;font-weight:700;">2</span></td>
          <td style="padding:8px 0;vertical-align:top;"><strong>Record a sale:</strong> Log it in 10 seconds via the web app or WhatsApp bot.</td>
        </tr>
        <tr>
          <td style="padding:8px 0;width:28px;vertical-align:top;"><span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:50%;background:${BRAND.ink};color:#fff;text-align:center;font-size:11px;font-weight:700;">3</span></td>
          <td style="padding:8px 0;vertical-align:top;"><strong>See your profit:</strong> Watch your real numbers update live &mdash; no guesswork.</td>
        </tr>
      </table>`,
      button: { label: 'Open my dashboard', url },
      footerNote: 'Tip: You can customize your daily/weekly WhatsApp digest in Settings &rarr; Summaries.',
    }),
  };
}

export function verificationEmail(name: string, url: string): { subject: string; html: string } {
  const firstName = name.split(' ')[0] || 'there';
  return {
    subject: 'Confirm your Ojaly account email',
    html: emailLayout({
      title: 'One quick tap to verify',
      preheader: 'Please confirm your email address to secure your Ojaly account.',
      badge: { text: 'Account Security', tone: 'green' },
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p>Thank you for setting up your business account on Ojaly. Tap the button below to confirm that this email address belongs to you.</p>
      <div style="background-color:${BRAND.cream};border-radius:12px;padding:14px 16px;margin:20px 0;font-size:13px;color:${BRAND.muted};">
        This secure verification link is valid for <strong>24 hours</strong>. If you did not create a Ojaly account, you can safely ignore this message.
      </div>`,
      button: { label: 'Confirm my email', url },
      footerNote: 'For security reasons, never forward this verification link to anyone.',
    }),
  };
}

export function resetPasswordEmail(name: string, url: string): { subject: string; html: string } {
  const firstName = name.split(' ')[0] || 'there';
  return {
    subject: 'Reset your Ojaly password',
    html: emailLayout({
      title: 'Reset your password',
      preheader: 'Use this secure link to set a new password for your Ojaly account.',
      badge: { text: 'Security Request', tone: 'orange' },
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p>We received a request to reset the password for your Ojaly account. Tap the button below to select a new password.</p>
      <div style="background-color:${BRAND.cream};border-radius:12px;padding:14px 16px;margin:20px 0;font-size:13px;color:${BRAND.muted};">
        This link expires in <strong>1 hour</strong>. If you did not initiate this request, your password remains unchanged and you can safely ignore this email.
      </div>`,
      button: { label: 'Choose new password', url },
      footerNote: 'Ojaly will never ask you for your password via email, SMS, or WhatsApp.',
    }),
  };
}

export function staffInviteEmail(name: string, businessName: string, inviterName: string, url: string): { subject: string; html: string } {
  const firstName = name.split(' ')[0] || 'there';
  return {
    subject: `${inviterName} invited you to join ${businessName} on Ojaly`,
    html: emailLayout({
      title: `You're invited to ${businessName}`,
      preheader: `${inviterName} has invited you to help manage ${businessName} on Ojaly.`,
      badge: { text: 'Team Invitation', tone: 'green' },
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p><strong>${escapeHtml(inviterName)}</strong> has added you as a team member for <strong>${escapeHtml(businessName)}</strong> on Ojaly.</p>
      <p>As a staff member, you can help record sales, track inventory, and view customer orders based on the permissions configured by the business owner.</p>`,
      button: { label: 'Accept invite & set password', url },
      footerNote: 'If you were not expecting this invitation, you can ignore this email.',
    }),
  };
}

export function lowStockEmail(businessName: string, items: { name: string; remaining: number }[], url: string): { subject: string; html: string } {
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BRAND.line};font-size:14px;color:${BRAND.ink};"><strong>${escapeHtml(i.name)}</strong></td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid ${BRAND.line};font-size:14px;font-weight:700;color:${i.remaining <= 0 ? BRAND.danger : BRAND.orange};">
          ${i.remaining <= 0 ? '<span style="background:#FDF2F2;padding:2px 8px;border-radius:6px;color:#C92A2A;">OUT OF STOCK</span>' : `${i.remaining} units remaining`}
        </td>
      </tr>`,
    )
    .join('');

  return {
    subject: `⚠️ Low stock alert for ${businessName}: ${items[0]?.name || 'Items running out'}`,
    html: emailLayout({
      title: 'Items need restocking',
      preheader: `${items.length} product${items.length === 1 ? '' : 's'} at ${businessName} have hit or fallen below low-stock thresholds.`,
      badge: { text: 'Inventory Alert', tone: 'danger' },
      body: `<p style="margin-top:0;">Don't miss the next sale! The following items in <strong>${escapeHtml(businessName)}</strong> are running dangerously low:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 24px;">
        ${rows}
      </table>
      <p>Restock now in your dashboard or log your latest inventory purchase.</p>`,
      button: { label: 'Update stock levels', url },
      footerNote: 'Manage threshold limits in Settings &rarr; Alerts.',
    }),
  };
}

export function debtReminderEmail(opts: {
  businessName: string;
  customerName: string;
  amountKobo: number;
  dueDate: string;
  paymentUrl?: string;
  businessPhone?: string;
}): { subject: string; html: string } {
  const firstName = opts.customerName.split(' ')[0] || opts.customerName;

  return {
    subject: `Friendly reminder: ${formatNaira(opts.amountKobo)} due to ${opts.businessName}`,
    html: emailLayout({
      title: 'A gentle balance reminder',
      preheader: `Your outstanding balance with ${opts.businessName} is ${formatNaira(opts.amountKobo)}, due ${opts.dueDate}.`,
      badge: { text: 'Payment Reminder', tone: 'gold' },
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p>This is a quick, friendly reminder regarding your outstanding balance with <strong>${escapeHtml(opts.businessName)}</strong>.</p>
      
      <div style="background-color:${BRAND.cream};border-radius:16px;padding:20px;margin:22px 0;border:1px solid ${BRAND.line};text-align:center;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:${BRAND.muted};font-weight:600;">Amount Due</div>
        <div style="font-size:32px;font-weight:800;color:${BRAND.orange};margin:8px 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk',Arial,sans-serif;">${formatNaira(opts.amountKobo)}</div>
        <div style="font-size:13px;color:${BRAND.muted};">Due date: <strong>${escapeHtml(opts.dueDate)}</strong></div>
      </div>

      ${
        opts.paymentUrl
          ? `<p style="background-color:${BRAND.forestSoft};padding:14px 16px;border-radius:12px;font-size:13px;color:${BRAND.forest};">
              <strong>Pay online securely:</strong> You can clear this balance instantly with debit card or bank transfer via our secure Paystack payment link below.
            </p>`
          : ''
      }
      <p style="font-size:13px;color:${BRAND.muted};">Already made this payment? Please ignore this notice &mdash; thank you so much for your business!</p>`,
      ...(opts.paymentUrl ? { button: { label: `Pay ${formatNaira(opts.amountKobo)} online`, url: opts.paymentUrl } } : {}),
      footerNote: opts.businessPhone ? `For questions or confirmation, contact ${escapeHtml(opts.businessName)} directly at ${escapeHtml(opts.businessPhone)}.` : undefined,
    }),
  };
}

export function receiptEmail(opts: {
  businessName: string;
  customerName: string;
  receiptNumber: string;
  totalKobo: number;
  receiptUrl: string;
  items: { name: string; quantity: number; totalKobo: number }[];
}): { subject: string; html: string } {
  const firstName = opts.customerName.split(' ')[0] || opts.customerName;
  const rows = opts.items
    .map(
      (i) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BRAND.line};font-size:14px;color:${BRAND.ink};">${escapeHtml(i.name)} &times; ${i.quantity}</td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid ${BRAND.line};font-size:14px;font-weight:600;color:${BRAND.ink};">${formatNaira(i.totalKobo)}</td>
      </tr>`,
    )
    .join('');

  return {
    subject: `Receipt #${opts.receiptNumber} from ${opts.businessName}`,
    html: emailLayout({
      title: 'Payment confirmed & receipt',
      preheader: `Thank you for your payment of ${formatNaira(opts.totalKobo)} to ${opts.businessName}. Receipt #${opts.receiptNumber}.`,
      badge: { text: 'Official Receipt', tone: 'green' },
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p>Thank you for supporting <strong>${escapeHtml(opts.businessName)}</strong>. Your payment has been received and verified.</p>
      
      <div style="background-color:${BRAND.cream};border-radius:16px;padding:22px;margin:22px 0;border:1px solid ${BRAND.line};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:${BRAND.muted};font-weight:700;">Receipt #${escapeHtml(opts.receiptNumber)}</td>
            <td align="right" style="font-size:12px;color:${BRAND.forest};font-weight:700;">PAID IN FULL</td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 16px;">
          ${rows}
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid ${BRAND.line};padding-top:12px;">
          <tr>
            <td style="font-size:16px;font-weight:800;color:${BRAND.ink};">Total Amount Paid</td>
            <td align="right" style="font-size:22px;font-weight:800;color:${BRAND.orange};font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk',Arial,sans-serif;">${formatNaira(opts.totalKobo)}</td>
          </tr>
        </table>
      </div>`,
      button: { label: 'View & download receipt', url: opts.receiptUrl },
      footerNote: 'Please retain this digital receipt for your financial records.',
    }),
  };
}

export function invoiceEmail(opts: {
  businessName: string;
  customerName: string;
  invoiceNumber: string;
  totalKobo: number;
  dueDate: string;
  invoiceUrl: string;
  paymentUrl?: string;
}): { subject: string; html: string } {
  const firstName = opts.customerName.split(' ')[0] || opts.customerName;

  return {
    subject: `Invoice #${opts.invoiceNumber} from ${opts.businessName}`,
    html: emailLayout({
      title: `Invoice #${opts.invoiceNumber}`,
      preheader: `Invoice for ${formatNaira(opts.totalKobo)} from ${opts.businessName}, due ${opts.dueDate}.`,
      badge: { text: 'New Invoice', tone: 'orange' },
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p>Please find your invoice from <strong>${escapeHtml(opts.businessName)}</strong> details below.</p>
      
      <div style="background-color:${BRAND.cream};border-radius:16px;padding:22px;margin:22px 0;border:1px solid ${BRAND.line};text-align:center;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:${BRAND.muted};font-weight:600;">Total Balance Due</div>
        <div style="font-size:32px;font-weight:800;color:${BRAND.ink};margin:8px 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk',Arial,sans-serif;">${formatNaira(opts.totalKobo)}</div>
        <div style="font-size:13px;color:${BRAND.muted};">Due date: <strong>${escapeHtml(opts.dueDate)}</strong></div>
      </div>`,
      button: { label: opts.paymentUrl ? 'Pay invoice online' : 'View invoice details', url: opts.paymentUrl || opts.invoiceUrl },
      footerNote: 'Thank you for your business!',
    }),
  };
}

export function summaryEmail(opts: {
  businessName: string;
  periodLabel: string;
  revenueKobo: number;
  profitKobo: number;
  expensesKobo: number;
  newDebtsKobo: number;
  topProduct?: string;
  lowStockCount: number;
  dashboardUrl: string;
}): { subject: string; html: string } {
  const statBox = (label: string, value: string, color = BRAND.ink, sublabel?: string) => `
    <td width="50%" style="padding:6px;">
      <div style="background-color:${BRAND.cream};border:1px solid ${BRAND.line};border-radius:14px;padding:16px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:${BRAND.muted};font-weight:700;margin-bottom:6px;">${label}</div>
        <div style="font-size:22px;font-weight:800;color:${color};font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk',Arial,sans-serif;">${value}</div>
        ${sublabel ? `<div style="font-size:11px;color:${BRAND.muted};margin-top:4px;">${sublabel}</div>` : ''}
      </div>
    </td>`;

  return {
    subject: `📊 Your ${opts.periodLabel} performance summary: ${opts.businessName}`,
    html: emailLayout({
      title: `Your ${opts.periodLabel} numbers are ready`,
      preheader: `Profit: ${formatNaira(opts.profitKobo)} | Revenue: ${formatNaira(opts.revenueKobo)} for ${opts.businessName}.`,
      badge: { text: 'Performance Report', tone: 'green' },
      body: `<p style="margin-top:0;">Here is how <strong>${escapeHtml(opts.businessName)}</strong> performed during this period:</p>
      
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stat-table" style="margin:16px -6px;">
        <tr>
          ${statBox('Total Revenue', formatNaira(opts.revenueKobo), BRAND.ink, 'Money received')}
          ${statBox('Net Profit', formatNaira(opts.profitKobo), opts.profitKobo >= 0 ? BRAND.success : BRAND.danger, 'Revenue minus COGS & expenses')}
        </tr>
        <tr>
          ${statBox('Total Expenses', formatNaira(opts.expensesKobo), BRAND.ink, 'Recorded business costs')}
          ${statBox('New Debts', formatNaira(opts.newDebtsKobo), opts.newDebtsKobo > 0 ? '#B45309' : BRAND.muted, 'Money still owed to you')}
        </tr>
      </table>

      <div style="background-color:${BRAND.forestSoft};border-radius:12px;padding:14px 16px;margin:20px 0;font-size:13px;color:${BRAND.forest};">
        ${opts.topProduct ? `<div>🌟 <strong>Top seller:</strong> ${escapeHtml(opts.topProduct)}</div>` : ''}
        <div style="margin-top:${opts.topProduct ? '6px' : '0'};">
          ${opts.lowStockCount > 0 ? `⚠️ <strong>${opts.lowStockCount} item${opts.lowStockCount === 1 ? '' : 's'}</strong> are below restocking thresholds.` : '✅ All inventory levels are healthy.'}
        </div>
      </div>`,
      button: { label: 'Explore detailed reports', url: opts.dashboardUrl },
      footerNote: 'Manage daily or weekly frequency and Lagos delivery time in Settings &rarr; Summaries.',
    }),
  };
}

export function storefrontMessageEmail(opts: {
  businessName: string;
  customerName: string;
  customerPhone: string;
  message: string;
  dashboardUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `💬 New website message from ${opts.customerName}`,
    html: emailLayout({
      title: 'New storefront inquiry',
      preheader: `${opts.customerName} (${opts.customerPhone}) sent an inquiry via ${opts.businessName}'s website.`,
      badge: { text: 'Customer Inquiry', tone: 'orange' },
      body: `<p style="margin-top:0;">A potential customer submitted an inquiry via your online storefront for <strong>${escapeHtml(opts.businessName)}</strong>:</p>
      
      <div style="background-color:${BRAND.cream};border-left:4px solid ${BRAND.orange};border-radius:0 12px 12px 0;padding:16px 18px;margin:18px 0;font-size:15px;color:${BRAND.ink};">
        <div style="font-size:12px;font-weight:700;color:${BRAND.muted};text-transform:uppercase;margin-bottom:6px;">
          ${escapeHtml(opts.customerName)} &middot; ${escapeHtml(opts.customerPhone)}
        </div>
        &ldquo;${escapeHtml(opts.message)}&rdquo;
      </div>
      <p style="font-size:13px;color:${BRAND.muted};">You can tap below to view the message in your notification inbox, or directly message the customer on WhatsApp.</p>`,
      button: { label: 'View in notification center', url: opts.dashboardUrl },
      footerNote: 'Quick replies convert 3x more customers into sales!',
    }),
  };
}

export function paymentFailedEmail(businessName: string, planName: string, url: string): { subject: string; html: string } {
  return {
    subject: `Payment unsuccessful for ${businessName}`,
    html: emailLayout({
      title: 'Subscription payment needed',
      preheader: `We were unable to process your payment for ${planName} at ${businessName}.`,
      badge: { text: 'Billing Notice', tone: 'danger' },
      body: `<p style="margin-top:0;">We were unable to process your recent renewal payment for <strong>${escapeHtml(businessName)}</strong> (${escapeHtml(planName)}).</p>
      <div style="background-color:${BRAND.dangerSoft};border-left:4px solid ${BRAND.danger};border-radius:0 12px 12px 0;padding:14px 16px;margin:18px 0;font-size:13px;color:#991B1B;">
        Don't worry &mdash; your business data, catalogue, and sales records are completely safe and intact.
      </div>
      <p>Please update your payment method or retry the transaction to ensure uninterrupted access to Hustle features.</p>`,
      button: { label: 'Retry payment now', url },
      footerNote: 'If funds were debited from your bank account, please reply to this email with your receipt reference.',
    }),
  };
}

export function orderNotificationSellerEmail(opts: {
  businessName: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  totalKobo: number;
  itemCount: number;
  orderUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `🛍️ New online order #${opts.orderNumber} (${formatNaira(opts.totalKobo)})`,
    html: emailLayout({
      title: 'New customer order received',
      preheader: `${opts.customerName} placed order #${opts.orderNumber} for ${formatNaira(opts.totalKobo)}.`,
      badge: { text: 'New Order', tone: 'green' },
      body: `<p style="margin-top:0;">You just received a new order on your online storefront for <strong>${escapeHtml(opts.businessName)}</strong>!</p>
      
      <div style="background-color:${BRAND.cream};border-radius:16px;padding:20px;margin:20px 0;border:1px solid ${BRAND.line};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:${BRAND.muted};font-weight:700;">Order #${escapeHtml(opts.orderNumber)}</td>
            <td align="right" style="font-size:14px;font-weight:700;color:${BRAND.orange};">${formatNaira(opts.totalKobo)}</td>
          </tr>
        </table>
        <div style="margin-top:12px;font-size:14px;color:${BRAND.ink};">
          <div><strong>Customer:</strong> ${escapeHtml(opts.customerName)} (${escapeHtml(opts.customerPhone)})</div>
          <div style="margin-top:4px;"><strong>Items:</strong> ${opts.itemCount} item(s) ordered</div>
        </div>
      </div>
      <p>Open the order to confirm fulfillment, print receipt, or contact the customer on WhatsApp.</p>`,
      button: { label: 'View order details', url: opts.orderUrl },
      footerNote: 'Keep your inventory synced and fulfill promptly for great customer reviews.',
    }),
  };
}
