// Strings for the account-creation flow, English and Arabic. The popup picks the language from the browser.
export type Lang = 'en' | 'ar';

export const STRINGS = {
  createAccount: { en: 'Create account', ar: 'إنشاء حساب' },
  haveAccount: { en: 'I already have an account', ar: 'لدي حساب بالفعل' },
  signIn: { en: 'Sign in', ar: 'تسجيل الدخول' },
  name: { en: 'Your name', ar: 'اسمك' },
  email: { en: 'Email', ar: 'البريد الإلكتروني' },
  password: { en: 'Password', ar: 'كلمة المرور' },
  signupClosedTitle: { en: 'Sign-up is closed', ar: 'التسجيل مغلق' },
  signupClosedBody: { en: "New accounts can't be created right now. Sign in if you already have one.", ar: 'لا يمكن إنشاء حسابات جديدة حاليًا. سجّل الدخول إذا كان لديك حساب.' },
  accountExists: { en: 'You already have an account with this email. Sign in instead.', ar: 'لديك حساب بهذا البريد الإلكتروني بالفعل. سجّل الدخول بدلًا من ذلك.' },
  codeSent: { en: 'Enter the 6-digit code we sent to {email}, or click the link in that email.', ar: 'أدخل الرمز المكوّن من 6 أرقام المرسل إلى {email}، أو اضغط على الرابط في الرسالة.' },
  enterCode: { en: 'Enter the 6-digit code.', ar: 'أدخل الرمز المكوّن من 6 أرقام.' },
  code: { en: '6-digit code', ar: 'الرمز المكوّن من 6 أرقام' },
  confirm: { en: 'Verify & continue', ar: 'تحقّق وتابع' },
  resendCode: { en: 'Resend code', ar: 'إعادة إرسال الرمز' },
  resendIn: { en: 'Resend code ({wait})', ar: 'إعادة الإرسال ({wait})' },
  differentEmail: { en: 'Use a different email', ar: 'استخدم بريداً آخر' },
  wrongCode: { en: 'That code is not right. {n} tries left.', ar: 'الرمز غير صحيح. المحاولات المتبقية: {n}.' },
  codeDead: { en: 'This code no longer works. Send a new one.', ar: 'لم يعد هذا الرمز صالحًا. أرسل رمزًا جديدًا.' },
  signupExpired: { en: 'This sign-up has expired. Sign in instead.', ar: 'انتهت صلاحية التسجيل. سجّل الدخول بدلًا من ذلك.' },
  waitingTitle: { en: 'Waiting for approval', ar: 'بانتظار الموافقة' },
  waitingBody: { en: "Your email is confirmed. Your workspace is waiting for approval; we'll email you when it's ready.", ar: 'تم تأكيد بريدك. بيئة العمل بانتظار الموافقة، وسنراسلك عندما تصبح جاهزة.' },
  checkAgain: { en: 'Check again', ar: 'تحقق مرة أخرى' },
  openYourApp: { en: 'Open your app, then click PinSay.', ar: 'افتح تطبيقك، ثم اضغط PinSay.' },
  createOwnWorkspace: { en: 'Create your own workspace', ar: 'أنشئ بيئة عمل خاصة بك' },
  confirmEmailFirst: { en: 'Confirm your email first — check your inbox.', ar: 'أكّد بريدك الإلكتروني أولًا — تحقق من صندوق الوارد.' },
  inviteDetected: { en: 'Invitation link detected on this page.', ar: 'تم رصد رابط دعوة في هذه الصفحة.' },
  useInvitation: { en: 'Use this invitation', ar: 'استخدام هذه الدعوة' },
  inviteRedeemFailed: { en: 'This invitation link could not be used — it may be expired. Ask for a new invitation.', ar: 'تعذّر استخدام رابط الدعوة — ربما انتهت صلاحيته. اطلب دعوة جديدة.' },
  inviteReentryHint: { en: 'Invited with a link? Reopen it from your email — it signs you straight back in until it expires. After that, ask the workspace admin for a new invitation.', ar: 'تمت دعوتك برابط؟ أعد فتحه من بريدك الإلكتروني — سيعيد تسجيل دخولك فورًا حتى انتهاء صلاحيته. بعدها اطلب دعوة جديدة من مسؤول مساحة العمل.' },
  visitorSiteTitle: { en: 'Feedback for {name}', ar: 'ملاحظات على {name}' },
  visitorLeave: { en: 'Leave feedback on this site', ar: 'أرسل ملاحظتك على هذا الموقع' },
  visitorTrack: { en: 'Track my feedback', ar: 'تابِع ملاحظاتي' },
  visitorTeamSignIn: { en: 'Team sign in', ar: 'دخول فريق العمل' },
  unclaimedTitle: { en: 'Feedback for this site', ar: 'ملاحظات على هذا الموقع' },
  unclaimedNote: { en: "Visitor feedback isn't open on this site. Your feedback is kept for its owner, and your email is optional. The page reloads once. Team members: sign in.", ar: 'ملاحظات الزوار غير مفعّلة على هذا الموقع. تُحفظ ملاحظتك لمالك الموقع، وبريدك الإلكتروني اختياري. سيُعاد تحميل الصفحة مرة واحدة. أعضاء الفريق: سجّلوا الدخول.' },
  unclaimedNoteMember: { en: 'No project in this workspace uses this site. You can still leave feedback for its owner.', ar: 'لا يوجد مشروع في مساحة العمل هذه يستخدم هذا الموقع. يمكنك مع ذلك ترك ملاحظة لمالكه.' },
  unclaimedLeave: { en: 'Leave feedback', ar: 'أرسل ملاحظة' },
  addAsNewProject: { en: 'Add as new project to {workspace}', ar: 'إضافة كمشروع جديد إلى {workspace}' },
  yourWorkspace: { en: 'your workspace', ar: 'مساحة عملك' },
  visitorNote: { en: 'You can report a bug or suggest an improvement. Your email is optional.', ar: 'يمكنك الإبلاغ عن مشكلة أو اقتراح تحسين. بريدك الإلكتروني اختياري.' },
  visitorTurnOff: { en: 'Turn off on this site', ar: 'إيقاف على هذا الموقع' },
  networkError: { en: "Can't reach the server. Try again.", ar: 'تعذّر الوصول إلى الخادم. حاول مرة أخرى.' },
  dismiss: { en: 'Dismiss', ar: 'إغلاق' },
  whatsNew: { en: "What's new", ar: 'ما الجديد' },
  checkEmailTitle: { en: 'Check your email', ar: 'تحقّق من بريدك الإلكتروني' },
  sendCode: { en: 'Send sign-in code', ar: 'أرسل رمز الدخول' },
  usePassword: { en: 'Sign in with password', ar: 'تسجيل الدخول بكلمة المرور' },
  useCode: { en: 'Use a sign-in code instead', ar: 'استخدم رمز دخول بدلاً من ذلك' },
  signInNote: { en: 'Sign in once — the extension keeps you signed in across every site.', ar: 'سجّل الدخول مرة واحدة — تُبقيك الإضافة مسجّلاً في كل المواقع.' },
  enterEmail: { en: 'Enter your email.', ar: 'أدخل بريدك الإلكتروني.' },
  enterEmailPassword: { en: 'Enter email and password.', ar: 'أدخل البريد الإلكتروني وكلمة المرور.' },
  enterNameEmail: { en: 'Enter your name and email.', ar: 'أدخل اسمك وبريدك الإلكتروني.' },
  accountPending: { en: 'Your account is waiting for approval.', ar: 'حسابك بانتظار الموافقة.' },
  accountRejected: { en: 'Your request was declined.', ar: 'تم رفض طلبك.' },
  accountDisabled: { en: 'This account is disabled.', ar: 'هذا الحساب معطّل.' },
  loginFailed: { en: 'Sign-in failed.', ar: 'تعذّر تسجيل الدخول.' },
  mfaOnDashboard: { en: 'This account uses two-factor sign-in. Sign in on the dashboard first.', ar: 'يستخدم هذا الحساب التحقق بخطوتين. سجّل الدخول من لوحة التحكم أولاً.' },
  noWorkspace: { en: "You're not in a workspace yet. Open the dashboard to accept an invite or create one.", ar: 'لست عضواً في أي مساحة عمل بعد. افتح لوحة التحكم لقبول دعوة أو إنشاء مساحة.' },
  throttled: { en: 'We just sent an email to this address. You can ask for another in {wait}.', ar: 'أرسلنا للتو رسالة إلى هذا العنوان. يمكنك طلب رسالة أخرى بعد {wait}.' },
  throttledMany: { en: 'Too many emails were sent to this address. Try again in {wait}.', ar: 'أُرسلت رسائل كثيرة إلى هذا العنوان. حاول مرة أخرى بعد {wait}.' },
  rateLimited: { en: 'There are too many requests from your network right now. Try again in {wait}.', ar: 'هناك طلبات كثيرة من شبكتك الآن. حاول مرة أخرى بعد {wait}.' },
  seconds_one: { en: '1 second', ar: 'ثانية واحدة' },
  seconds_two: { en: '2 seconds', ar: 'ثانيتين' },
  seconds_few: { en: '{n} seconds', ar: '{n} ثوانٍ' },
  seconds_many: { en: '{n} seconds', ar: '{n} ثانية' },
  seconds_other: { en: '{n} seconds', ar: '{n} ثانية' },
  minutes_one: { en: '1 minute', ar: 'دقيقة واحدة' },
  minutes_two: { en: '2 minutes', ar: 'دقيقتين' },
  minutes_few: { en: '{n} minutes', ar: '{n} دقائق' },
  minutes_many: { en: '{n} minutes', ar: '{n} دقيقة' },
  minutes_other: { en: '{n} minutes', ar: '{n} دقيقة' },
  chooseWorkspace: { en: 'Choose a workspace', ar: 'اختر مساحة عمل' },
  chooseWorkspaceBody: { en: 'You belong to more than one workspace. Pick the one to work in; you can switch later.', ar: 'أنت عضو في أكثر من مساحة عمل. اختر المساحة التي تعمل فيها؛ يمكنك التبديل لاحقاً.' },
  workspace: { en: 'Workspace', ar: 'مساحة العمل' },
  continue: { en: 'Continue', ar: 'متابعة' },
  backToSignIn: { en: 'Back to sign in', ar: 'العودة لتسجيل الدخول' },
  selectWorkspace: { en: 'Please select a workspace.', ar: 'يُرجى اختيار مساحة عمل.' },
  selectWorkspaceFailed: { en: 'Could not select the workspace.', ar: 'تعذّر اختيار مساحة العمل.' },
  guideTitle: { en: 'Your first comment', ar: 'تعليقك الأول' },
  guideSignIn: { en: 'Sign in with the same account you use on the PinSay dashboard.', ar: 'سجّل الدخول بنفس الحساب الذي تستخدمه في لوحة تحكم PinSay.' },
  guideSignedIn: { en: 'Signed in', ar: 'تم تسجيل الدخول' },
  guideChoose: { en: 'Choose “{project}” under Project.', ar: 'اختر «{project}» من قائمة المشروع.' },
  guideActivate: { en: 'Click “Activate on this tab”.', ar: 'اضغط «Activate on this tab».' },
  guideComment: { en: 'PinSay is on. Click Comment in the toolbar on your page, then click what you want to change.', ar: 'PinSay يعمل الآن. اضغط «تعليق» في شريط الأدوات على صفحتك، ثم اضغط على ما تريد تغييره.' },
  guideOpenSite: { en: 'Open {origin} in this tab first.', ar: 'افتح {origin} في هذا التبويب أولًا.' },
  guideDismiss: { en: 'Hide', ar: 'إخفاء' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function langFor(navigatorLanguage: string | undefined): Lang {
  return (navigatorLanguage || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export const LANG: Lang = langFor(typeof navigator !== 'undefined' ? navigator.language : undefined);

/** The text for `key` in `lang`, with every `{name}` replaced from `vars`. */
export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  const text: string = STRINGS[key][lang];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

export function t(key: StringKey, vars?: Record<string, string | number>): string {
  return translate(LANG, key, vars);
}

/** 2026-10-28: "45 seconds" / "3 minutes" (minutes rounded up) in the popup's language. */
export function waitText(seconds: number, lang: Lang): string {
  const minutes = seconds >= 60;
  const n = minutes ? Math.ceil(seconds / 60) : Math.max(1, Math.ceil(seconds));
  const cat = new Intl.PluralRules(lang).select(n);
  const form = lang === 'ar' ? (cat === 'zero' ? 'other' : cat) : cat === 'one' ? 'one' : 'other';
  return translate(lang, `${minutes ? 'minutes' : 'seconds'}_${form}` as StringKey, { n });
}
