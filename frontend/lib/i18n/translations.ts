export const LANGUAGE_NATIVE_NAMES = {
  en: "English",
  de: "Deutsch",
  pt: "Português",
  hr: "Hrvatski",
  es: "Español",
} as const;

export type AppLanguage = "auto" | "en" | "de" | "pt" | "hr" | "es";

export type TranslationKey =
  // Common
  | "common.close"
  | "common.save"
  | "common.cancel"
  | "common.done"
  | "common.loading"
  | "common.search"
  | "common.more"
  | "common.back"
  | "common.copy"
  | "common.copied"

  // Menu
  | "menu.settings"
  | "menu.help"
  | "menu.logout"
  | "menu.copyId"

  // Settings nav
  | "settings.title"
  | "settings.general"
  | "settings.notifications"
  | "settings.personalization"
  | "settings.apps"
  | "settings.schedules"
  | "settings.dataControls"
  | "settings.security"
  | "settings.parentalControls"
  | "settings.account"
  | "settings.comingSoon"

  // Settings: General
  | "settings.appearance"
  | "settings.appearance.system"
  | "settings.appearance.light"
  | "settings.appearance.dark"
  | "settings.accentColor"
  | "settings.language"
  | "settings.language.auto"
  | "settings.language.en"
  | "settings.language.de"
  | "settings.language.pt"
  | "settings.language.hr"
  | "settings.language.es"
  | "settings.language_option_auto"
  | "settings.appearance_title"
  | "settings.appearance_description"
  | "settings.accent_color_title"
  | "settings.accent_color_help"
  | "settings.accent_color_copy"
  | "settings.language_help"
  | "settings.admin_label"
  | "settings.admin_title"
  | "settings.admin_description"
  | "settings.admin_workspace"
  | "settings.admin_members"
  | "settings.admin_access"

  // Workspace nav
  | "nav.dashboard"
  | "nav.calendar"
  | "nav.mail"
  | "nav.tasks"
  | "nav.docsSlides"
  | "nav.build"
  | "nav.buildConsole"
  | "nav.automations"
  | "nav.reasoning"
  | "nav.integrations"
  | "nav.marketplace"
  | "nav.settings"
  | "nav.sales"
  | "nav.hr"
  | "nav.marketing"
  | "nav.group.work"
  | "nav.group.business"
  | "nav.group.build"

  // Dashboard
  | "dashboard.heroLabel"
  | "dashboard.title"
  | "dashboard.subtitle"
  | "dashboard.heroDescription"
  | "dashboard.status.connected"
  | "dashboard.status.context"
  | "dashboard.status.latency"
  | "dashboard.kpi.tasksActive"
  | "dashboard.kpi.helper.tasksActive"
  | "dashboard.kpi.agentsOnline"
  | "dashboard.kpi.helper.agentsOnline"
  | "dashboard.kpi.queueHealth"
  | "dashboard.kpi.helper.queueHealth"
  | "dashboard.section.pipeline"
  | "dashboard.pipeline.step.analyze.title"
  | "dashboard.pipeline.step.analyze.description"
  | "dashboard.pipeline.step.optimize.title"
  | "dashboard.pipeline.step.optimize.description"
  | "dashboard.pipeline.step.deploy.title"
  | "dashboard.pipeline.step.deploy.description"
  | "dashboard.section.quickActions"
  | "dashboard.action.openMail"
  | "dashboard.action.openTasks"
  | "dashboard.action.openBuildConsole"
  | "dashboard.section.activity"
  | "dashboard.activity.item.vendor.title"
  | "dashboard.activity.item.vendor.detail"
  | "dashboard.activity.item.queue.title"
  | "dashboard.activity.item.queue.detail"
  | "dashboard.activity.item.context.title"
  | "dashboard.activity.item.context.detail"
  | "dashboard.activity.timestamp.recent"
  | "dashboard.activity.timestamp.minutes"
  | "dashboard.activity.timestamp.hour"
  | "dashboard.empty.activity"

  // Mail
  | "mail.moduleLabel"
  | "mail.moduleSubtitle"
  | "mail.loadingTitle"
  | "mail.loadingSubtitle"
  | "mail.notConnectedTitle"
  | "mail.notConnectedSubtitle"
  | "mail.connectedTitle"
  | "mail.connectedSubtitle"
  | "mail.noAccessTitle"
  | "mail.noAccessSubtitle"
  | "mail.errorTitle"
  | "mail.errorSubtitle"
  | "mail.trashFailed"
  | "mail.reload"
  | "mail.newMail"
  | "mail.to"
  | "mail.subject"
  | "mail.message"
  | "mail.send"
  | "mail.delete"
  | "mail.moveToTrash"
  | "mail.archive"
  | "mail.inbox"
  | "mail.sent"
  | "mail.drafts"
  | "mail.spam"
  | "mail.trashFolder"
  | "mail.starred"
  | "mail.categories"
  | "mail.category.promotions"
  | "mail.category.social"
  | "mail.category.updates"
  | "mail.category.forums"
  | "mail.labelsLoading"
  | "mail.searchPlaceholder"
  | "mail.more"
  | "mail.emptyInbox"
  | "mail.noResults"
  | "mail.noSubject"
  | "mail.unknownDate"
  | "mail.unknownSender"
  | "mail.noPreview"
  | "mail.loadingMessage"
  | "mail.selectThread"
  | "mail.connectOrSelect"
  | "mail.messagesLabel"
  | "mail.composeFillFields"
  | "mail.composeSent"
  | "mail.composeFailed"
  | "mail.emptySelect"
  | "mail.reply"
  | "mail.forward"
  | "calendar.connectIcloud"
  | "mail.connectIcloud"

  // Elly
  | "elly.label"
  | "elly.toggle"
  | "elly.action"
  | "elly.execute"
  | "elly.hint"
  | "elly.options"
  | "elly.options.placeholder"
  | "elly.output.empty"
  | "elly.offlineBadge"

  // Elly intents (Mail)
  | "elly.intent.summarize"
  | "elly.intent.draftReply"
  | "elly.intent.extractTasks"
  | "elly.intent.desc.summarize"
  | "elly.intent.desc.draftReply"
  | "elly.intent.desc.extractTasks"

  // Elly intents (Compose)
  | "elly.compose.label"
  | "elly.compose.helper"
  | "elly.compose.intent.writeDraft"
  | "elly.compose.intent.shorten"
  | "elly.compose.intent.toneFriendly"
  | "elly.compose.intent.toneProfessional"
  | "elly.compose.intent.polish";

type Dict = Record<TranslationKey, string>;

export const translations: Record<Exclude<AppLanguage, "auto">, Dict> = {
  en: {
    // Common
    "common.close": "Close",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.done": "Done",
    "common.loading": "Loading…",
    "common.search": "Search",
    "common.more": "More",
    "common.back": "Back",
    "common.copy": "Copy",
    "common.copied": "Copied",

    // Menu
    "menu.settings": "Settings",
    "menu.help": "Help",
    "menu.logout": "Logout",
    "menu.copyId": "Copy ID",

    // Settings nav
    "settings.title": "Settings",
    "settings.general": "General",
    "settings.notifications": "Notifications",
    "settings.personalization": "Personalization",
    "settings.apps": "Apps",
    "settings.schedules": "Schedules",
    "settings.dataControls": "Data controls",
    "settings.security": "Security",
    "settings.parentalControls": "Parental controls",
    "settings.account": "Account",
    "settings.comingSoon": "Coming soon",

    // Settings: General
    "settings.appearance": "Appearance",
    "settings.appearance.system": "System",
    "settings.appearance.light": "Light",
    "settings.appearance.dark": "Dark",
    "settings.accentColor": "Accent color",
    "settings.language": "Language",
    "settings.language.auto": "Auto-detect",
    "settings.language.en": "English",
    "settings.language.de": "German",
    "settings.language.pt": "Portuguese",
    "settings.language.hr": "Croatian",
    "settings.language.es": "Spanish",
    "settings.language_option_auto": "Auto-detect",
    "settings.appearance_title": "Appearance",
    "settings.appearance_description": "Theme and display preferences.",
    "settings.accent_color_title": "Accent color",
    "settings.accent_color_help": "Highlight your workspace with a signature hue.",
    "settings.accent_color_copy": "Copy accent hex",
    "settings.language_help": "Choose the interface language.",

    // Settings: Admin
    "settings.admin_label": "Admin only",
    "settings.admin_title": "Admin controls",
    "settings.admin_description": "Manage workspace members, permissions, and identity settings.",
    "settings.admin_workspace": "Workspace admin",
    "settings.admin_members": "Team / Members",
    "settings.admin_access": "Permissions / Access",

    // Workspace nav
    "nav.dashboard": "Dashboard",
    "nav.calendar": "Calendar",
    "nav.mail": "Mail",
    "nav.tasks": "Tasks",
    "nav.docsSlides": "Docs & Slides",
    "nav.build": "Build",
    "nav.buildConsole": "Build Console",
    "nav.automations": "Automations",
    "nav.reasoning": "Reasoning",
    "nav.integrations": "Integrations",
    "nav.marketplace": "Marketplace",
    "nav.settings": "Settings",
    "nav.sales": "Sales",
    "nav.hr": "HR",
    "nav.marketing": "Marketing",
    "nav.group.work": "Work",
    "nav.group.business": "Business",
    "nav.group.build": "Build",

    // Dashboard
    "dashboard.heroLabel": "Elly presence",
    "dashboard.title": "Workspace control center",
    "dashboard.subtitle": "Calm intelligence that keeps Mail, Tasks, and Build aligned.",
    "dashboard.heroDescription": "Elly Presence keeps the center lane dedicated to context, clarity, and the next best action.",
    "dashboard.status.connected": "Connected",
    "dashboard.status.context": "Context",
    "dashboard.status.latency": "Latency",
    "dashboard.kpi.tasksActive": "Active tasks",
    "dashboard.kpi.helper.tasksActive": "Tracking team workstreams.",
    "dashboard.kpi.agentsOnline": "Agents online",
    "dashboard.kpi.helper.agentsOnline": "All agents ready for hand-offs.",
    "dashboard.kpi.queueHealth": "Queue health",
    "dashboard.kpi.helper.queueHealth": "Processing staying within tolerance.",
    "dashboard.section.pipeline": "Intent pipeline",
    "dashboard.pipeline.step.analyze.title": "Analyze context",
    "dashboard.pipeline.step.analyze.description": "Elly ingests the latest signals before surfacing recommendations.",
    "dashboard.pipeline.step.optimize.title": "Optimize flows",
    "dashboard.pipeline.step.optimize.description": "Adjustments are queued to keep the workspace calm and focused.",
    "dashboard.pipeline.step.deploy.title": "Deploy & monitor",
    "dashboard.pipeline.step.deploy.description": "Actions move forward while Elly watches for drift and latency.",
    "dashboard.section.quickActions": "Quick actions",
    "dashboard.action.openMail": "Open Mail",
    "dashboard.action.openTasks": "Open Tasks",
    "dashboard.action.openBuildConsole": "Open Build console",
    "dashboard.section.activity": "Activity",
    "dashboard.activity.item.vendor.title": "Vendor coordination flagged",
    "dashboard.activity.item.vendor.detail": "Primary vendor has not responded; consider nudging for coverage.",
    "dashboard.activity.item.queue.title": "Queue sync complete",
    "dashboard.activity.item.queue.detail": "24 tasks are lined up for Ops, Sales, and Marketing.",
    "dashboard.activity.item.context.title": "Context refreshed",
    "dashboard.activity.item.context.detail": "Mail, calendar, and build signals are aligned with today’s intent.",
    "dashboard.activity.timestamp.recent": "2m ago",
    "dashboard.activity.timestamp.minutes": "17m ago",
    "dashboard.activity.timestamp.hour": "Today · 10:02",
    "dashboard.empty.activity": "No recent activity yet.",

    // Mail
    "mail.moduleLabel": "Mail",
    "mail.moduleSubtitle": "Handle your workspace inbox.",
    "mail.loadingTitle": "Loading mail",
    "mail.loadingSubtitle": "Hang tight while we load your messages.",
    "mail.notConnectedTitle": "Mail not connected",
    "mail.notConnectedSubtitle": "Connect an account to start reading mail.",
    "mail.connectedTitle": "Mail connected",
    "mail.connectedSubtitle":
      "You can read your inbox, open emails, and ask Elly to draft replies.",
    "mail.noAccessTitle": "No mail access",
    "mail.noAccessSubtitle": "This workspace needs permission to show mail.",
    "mail.errorTitle": "Mail error",
    "mail.errorSubtitle": "Something went wrong while syncing mail.",
    "mail.trashFailed": "Unable to move the conversation to Trash.",
    "mail.reload": "Reload",
    "mail.newMail": "New mail",
    "mail.to": "To",
    "mail.subject": "Subject",
    "mail.message": "Message",
    "mail.send": "Send",
    "mail.delete": "Delete",
    "mail.moveToTrash": "Move to Trash",
    "mail.archive": "Archive",
    "mail.inbox": "Inbox",
    "mail.sent": "Sent",
    "mail.drafts": "Drafts",
    "mail.spam": "Spam",
    "mail.trashFolder": "Trash",
    "mail.starred": "Starred",
    "mail.categories": "Categories",
    "mail.category.promotions": "Promotions",
    "mail.category.social": "Social",
    "mail.category.updates": "Updates",
    "mail.category.forums": "Forums",
    "mail.labelsLoading": "Loading labels…",
    "mail.searchPlaceholder": "Search mail",
    "mail.more": "More",
    "mail.emptyInbox": "Your inbox is empty.",
    "mail.noResults": "No conversations match that search.",
    "mail.noSubject": "No subject",
    "mail.unknownDate": "Unknown date",
    "mail.unknownSender": "Unknown sender",
    "mail.noPreview": "No preview available",
    "mail.loadingMessage": "Loading messages…",
    "mail.selectThread": "Select a conversation to read it.",
    "mail.connectOrSelect": "Connect an account or select a thread.",
    "mail.messagesLabel": "messages",
    "mail.composeFillFields": "Fill in the recipient, subject, and body.",
    "mail.composeSent": "Message sent",
    "mail.composeFailed": "Unable to send the message.",
    "mail.emptySelect": "Select an email to read it.",
    "mail.reply": "Reply",
    "mail.forward": "Forward",
    "calendar.connectIcloud": "Connect iCloud Calendar",
    "mail.connectIcloud": "Connect iCloud Mail",

    // Elly
    "elly.label": "Elly",
    "elly.toggle": "Toggle Elly panel",
    "elly.action": "Action",
    "elly.execute": "Run",
    "elly.hint": "Choose an action and click Run.",
    "elly.options": "Options",
    "elly.options.placeholder": "Optional: tone, format, key points, length…",
    "elly.output.empty": "No output yet. Choose an action and click Run.",
    "elly.offlineBadge": "Offline mode",

    // Elly intents (Mail)
    "elly.intent.summarize": "Summarize",
    "elly.intent.draftReply": "Draft reply",
    "elly.intent.extractTasks": "Extract tasks",
    "elly.intent.desc.summarize": "A short summary of this email",
    "elly.intent.desc.draftReply": "A professional reply you can send",
    "elly.intent.desc.extractTasks": "Turn this email into actionable tasks",

    // Elly intents (Compose)
    "elly.compose.label": "Elly",
    "elly.compose.helper": "Helps you write faster",
    "elly.compose.intent.writeDraft": "Write a draft",
    "elly.compose.intent.shorten": "Make it shorter",
    "elly.compose.intent.toneFriendly": "Friendlier tone",
    "elly.compose.intent.toneProfessional": "More professional tone",
    "elly.compose.intent.polish": "Polish grammar",
  },

  de: {
    // Common
    "common.close": "Schließen",
    "common.save": "Speichern",
    "common.cancel": "Abbrechen",
    "common.done": "Fertig",
    "common.loading": "Lädt…",
    "common.search": "Suchen",
    "common.more": "Mehr",
    "common.back": "Zurück",
    "common.copy": "Kopieren",
    "common.copied": "Kopiert",

    // Menu
    "menu.settings": "Einstellungen",
    "menu.help": "Hilfe",
    "menu.logout": "Abmelden",
    "menu.copyId": "ID kopieren",

    // Settings nav
    "settings.title": "Einstellungen",
    "settings.general": "Allgemein",
    "settings.notifications": "Benachrichtigungen",
    "settings.personalization": "Personalisierung",
    "settings.apps": "Apps",
    "settings.schedules": "Zeitpläne",
    "settings.dataControls": "Datenkontrollen",
    "settings.security": "Sicherheit",
    "settings.parentalControls": "Kindersicherung",
    "settings.account": "Konto",
    "settings.comingSoon": "Kommt bald",

    // Settings: General
    "settings.appearance": "Aussehen",
    "settings.appearance.system": "System",
    "settings.appearance.light": "Hell",
    "settings.appearance.dark": "Dunkel",
    "settings.accentColor": "Akzentfarbe",
    "settings.language": "Sprache",
    "settings.language.auto": "Automatisch erkennen",
    "settings.language.en": "Englisch",
    "settings.language.de": "Deutsch",
    "settings.language.pt": "Portugiesisch",
    "settings.language.hr": "Kroatisch",
    "settings.language.es": "Spanisch",
    "settings.language_option_auto": "Automatisch erkennen",
    "settings.appearance_title": "Aussehen",
    "settings.appearance_description": "Design- und Anzeigeeinstellungen.",
    "settings.accent_color_title": "Akzentfarbe",
    "settings.accent_color_help": "Hebe deinen Workspace mit einer Signalfarbe hervor.",
    "settings.accent_color_copy": "Akzentwert kopieren",
    "settings.language_help": "Wähle die Sprache der Oberfläche.",

    // Settings: Admin
    "settings.admin_label": "Nur Admin",
    "settings.admin_title": "Admin-Bereich",
    "settings.admin_description": "Verwalte Mitglieder, Berechtigungen und Identitätsoptionen.",
    "settings.admin_workspace": "Workspace-Admin",
    "settings.admin_members": "Team / Mitglieder",
    "settings.admin_access": "Berechtigungen / Zugriff",

    // Workspace nav
    "nav.dashboard": "Dashboard",
    "nav.calendar": "Kalender",
    "nav.mail": "Mail",
    "nav.tasks": "Tasks",
    "nav.docsSlides": "Dokumente & Slides",
    "nav.build": "Build",
    "nav.buildConsole": "Build-Konsole",
    "nav.automations": "Automationen",
    "nav.reasoning": "Reasoning",
    "nav.integrations": "Integrationen",
    "nav.marketplace": "Marktplatz",
    "nav.settings": "Einstellungen",
    "nav.sales": "Vertrieb",
    "nav.hr": "HR",
    "nav.marketing": "Marketing",
    "nav.group.work": "Arbeit",
    "nav.group.business": "Business",
    "nav.group.build": "Build",

    // Dashboard
    "dashboard.heroLabel": "Elly-Präsenz",
    "dashboard.title": "Workspace-Kommandozentrale",
    "dashboard.subtitle": "Gelassene Intelligenz, die Mail, Tasks und Build synchron hält.",
    "dashboard.heroDescription": "Elly-Präsenz reserviert die Mittelsäule für Kontext, Klarheit und die nächste Handlung.",
    "dashboard.status.connected": "Verbunden",
    "dashboard.status.context": "Kontext",
    "dashboard.status.latency": "Latenz",
    "dashboard.kpi.tasksActive": "Aktive Tasks",
    "dashboard.kpi.helper.tasksActive": "Behält Team-Workstreams im Blick.",
    "dashboard.kpi.agentsOnline": "Agenten online",
    "dashboard.kpi.helper.agentsOnline": "Alle Agenten bereit für Übergaben.",
    "dashboard.kpi.queueHealth": "Warteschlange",
    "dashboard.kpi.helper.queueHealth": "Verarbeitung bleibt im grünen Bereich.",
    "dashboard.section.pipeline": "Intent-Pipeline",
    "dashboard.pipeline.step.analyze.title": "Kontext analysieren",
    "dashboard.pipeline.step.analyze.description": "Elly liest die aktuellen Signale, bevor Empfehlungen erscheinen.",
    "dashboard.pipeline.step.optimize.title": "Flows optimieren",
    "dashboard.pipeline.step.optimize.description": "Anpassungen werden angestoßen, damit der Workspace ruhig bleibt.",
    "dashboard.pipeline.step.deploy.title": "Bereitstellen & beobachten",
    "dashboard.pipeline.step.deploy.description": "Aktionen laufen weiter, während Elly nach Drift und Latenz sucht.",
    "dashboard.section.quickActions": "Schnellaktionen",
    "dashboard.action.openMail": "Mail öffnen",
    "dashboard.action.openTasks": "Tasks öffnen",
    "dashboard.action.openBuildConsole": "Build-Konsole öffnen",
    "dashboard.section.activity": "Aktivität",
    "dashboard.activity.item.vendor.title": "Vendor-Koordination markiert",
    "dashboard.activity.item.vendor.detail": "Der Hauptvendor antwortet noch nicht; ein Reminder hilft bei der Abdeckung.",
    "dashboard.activity.item.queue.title": "Warteschlange synchronisiert",
    "dashboard.activity.item.queue.detail": "24 Tasks für Ops, Vertrieb und Marketing stehen bereit.",
    "dashboard.activity.item.context.title": "Kontext aktualisiert",
    "dashboard.activity.item.context.detail": "Mail, Kalender und Build melden sich im heutigen Intent.",
    "dashboard.activity.timestamp.recent": "vor 2 Min.",
    "dashboard.activity.timestamp.minutes": "vor 17 Min.",
    "dashboard.activity.timestamp.hour": "Heute · 10:02",
    "dashboard.empty.activity": "Noch keine Aktivitäten.",

    // Mail
    "mail.moduleLabel": "Mail",
    "mail.moduleSubtitle": "Verwalte deinen Workspace-Posteingang.",
    "mail.loadingTitle": "Mail wird geladen",
    "mail.loadingSubtitle": "Wir laden gerade deine Nachrichten.",
    "mail.notConnectedTitle": "Mail nicht verbunden",
    "mail.notConnectedSubtitle": "Verbinde ein Konto, um E-Mails zu lesen.",
    "mail.connectedTitle": "Mail verbunden",
    "mail.connectedSubtitle":
      "Du kannst den Posteingang lesen, E-Mails öffnen und Elly um Entwürfe bitten.",
    "mail.noAccessTitle": "Kein Mail-Zugriff",
    "mail.noAccessSubtitle": "Dieser Workspace hat noch keine Mail-Berechtigungen.",
    "mail.errorTitle": "Mail-Fehler",
    "mail.errorSubtitle": "Beim Synchronisieren der Mail ist etwas schiefgelaufen.",
    "mail.trashFailed": "Konversation konnte nicht in den Papierkorb verschoben werden.",
    "mail.reload": "Neu laden",
    "mail.newMail": "Neue Mail",
    "mail.to": "Empfänger",
    "mail.subject": "Betreff",
    "mail.message": "Nachricht",
    "mail.send": "Senden",
    "mail.delete": "Löschen",
    "mail.moveToTrash": "In den Papierkorb verschieben",
    "mail.archive": "Archivieren",
    "mail.inbox": "Posteingang",
    "mail.sent": "Gesendet",
    "mail.drafts": "Entwürfe",
    "mail.spam": "Spam",
    "mail.trashFolder": "Papierkorb",
    "mail.starred": "Markiert",
    "mail.categories": "Kategorien",
    "mail.category.promotions": "Werbung",
    "mail.category.social": "Soziales",
    "mail.category.updates": "Updates",
    "mail.category.forums": "Foren",
    "mail.labelsLoading": "Labels werden geladen…",
    "mail.searchPlaceholder": "Mail durchsuchen",
    "mail.more": "Mehr",
    "mail.emptyInbox": "Dein Posteingang ist leer.",
    "mail.noResults": "Keine Unterhaltung passt zur Suche.",
    "mail.noSubject": "Kein Betreff",
    "mail.unknownDate": "Unbekanntes Datum",
    "mail.unknownSender": "Unbekannter Absender",
    "mail.noPreview": "Keine Vorschau verfügbar",
    "mail.loadingMessage": "Nachrichten werden geladen…",
    "mail.selectThread": "Wähle eine Unterhaltung zum Lesen.",
    "mail.connectOrSelect": "Verbinde ein Konto oder wähle einen Thread.",
    "mail.messagesLabel": "Nachrichten",
    "mail.composeFillFields": "Empfänger, Betreff und Nachricht ausfüllen.",
    "mail.composeSent": "Nachricht gesendet",
    "mail.composeFailed": "Nachricht konnte nicht gesendet werden.",
    "mail.emptySelect": "Wähle eine E-Mail aus, um sie zu lesen.",
    "mail.reply": "Antworten",
    "mail.forward": "Weiterleiten",
    "calendar.connectIcloud": "iCloud-Kalender verbinden",
    "mail.connectIcloud": "iCloud Mail verbinden",

    // Elly
    "elly.label": "Elly",
    "elly.toggle": "Elly-Panel umschalten",
    "elly.action": "Aktion",
    "elly.execute": "Ausführen",
    "elly.hint": "Wähle eine Aktion und klicke auf Ausführen.",
    "elly.options": "Optionen",
    "elly.options.placeholder": "Optional: Ton, Format, Stichpunkte, Länge …",
    "elly.output.empty": "Noch keine Ausgabe. Wähle eine Aktion und klicke auf Ausführen.",
    "elly.offlineBadge": "Offline-Modus",

    // Elly intents (Mail)
    "elly.intent.summarize": "Zusammenfassen",
    "elly.intent.draftReply": "Antwort entwerfen",
    "elly.intent.extractTasks": "Aufgaben extrahieren",
    "elly.intent.desc.summarize": "Kurze Zusammenfassung der E-Mail",
    "elly.intent.desc.draftReply": "Professionelle Antwort zum Versenden",
    "elly.intent.desc.extractTasks": "To-dos aus der E-Mail ableiten",

    // Elly intents (Compose)
    "elly.compose.label": "Elly",
    "elly.compose.helper": "Hilft dir beim Formulieren",
    "elly.compose.intent.writeDraft": "Entwurf schreiben",
    "elly.compose.intent.shorten": "Kürzer machen",
    "elly.compose.intent.toneFriendly": "Freundlicher Ton",
    "elly.compose.intent.toneProfessional": "Professioneller Ton",
    "elly.compose.intent.polish": "Grammatik verbessern",
  },

  pt: {
    // Common
    "common.close": "Fechar",
    "common.save": "Guardar",
    "common.cancel": "Cancelar",
    "common.done": "Concluído",
    "common.loading": "A carregar…",
    "common.search": "Pesquisar",
    "common.more": "Mais",
    "common.back": "Voltar",
    "common.copy": "Copiar",
    "common.copied": "Copiado",

    // Menu
    "menu.settings": "Definições",
    "menu.help": "Ajuda",
    "menu.logout": "Terminar sessão",
    "menu.copyId": "Copiar ID",

    // Settings nav
    "settings.title": "Definições",
    "settings.general": "Geral",
    "settings.notifications": "Notificações",
    "settings.personalization": "Personalização",
    "settings.apps": "Apps",
    "settings.schedules": "Planos",
    "settings.dataControls": "Controlos de dados",
    "settings.security": "Segurança",
    "settings.parentalControls": "Controlos parentais",
    "settings.account": "Conta",
    "settings.comingSoon": "Em breve",

    // Settings: General
    "settings.appearance": "Aspeto",
    "settings.appearance.system": "Sistema",
    "settings.appearance.light": "Claro",
    "settings.appearance.dark": "Escuro",
    "settings.accentColor": "Cor de destaque",
    "settings.language": "Idioma",
    "settings.language.auto": "Detetar automaticamente",
    "settings.language.en": "Inglês",
    "settings.language.de": "Alemão",
    "settings.language.pt": "Português",
    "settings.language.hr": "Croata",
    "settings.language.es": "Espanhol",
    "settings.language_option_auto": "Detetar automaticamente",
    "settings.appearance_title": "Aspeto",
    "settings.appearance_description": "Preferências de tema e apresentação.",
    "settings.accent_color_title": "Cor de destaque",
    "settings.accent_color_help": "Use esta cor para destacar o seu workspace.",
    "settings.accent_color_copy": "Copiar código da cor",
    "settings.language_help": "Escolha o idioma da interface.",

    // Settings: Admin
    "settings.admin_label": "Apenas admin",
    "settings.admin_title": "Controlo de administrador",
    "settings.admin_description": "Gerir membros, permissões e identidade.",
    "settings.admin_workspace": "Admin do workspace",
    "settings.admin_members": "Equipa / Membros",
    "settings.admin_access": "Permissões / Acesso",

    // Workspace nav
    "nav.dashboard": "Painel",
    "nav.calendar": "Calendário",
    "nav.mail": "Email",
    "nav.tasks": "Tarefas",
    "nav.docsSlides": "Docs e Slides",
    "nav.build": "Build",
    "nav.buildConsole": "Consola de Build",
    "nav.automations": "Automações",
    "nav.reasoning": "Raciocínio",
    "nav.integrations": "Integrações",
    "nav.marketplace": "Marketplace",
    "nav.settings": "Definições",
    "nav.sales": "Vendas",
    "nav.hr": "RH",
    "nav.marketing": "Marketing",
    "nav.group.work": "Trabalho",
    "nav.group.business": "Negócios",
    "nav.group.build": "Build",

    // Dashboard
    "dashboard.heroLabel": "Presença Elly",
    "dashboard.title": "Centro de comando",
    "dashboard.subtitle": "Inteligência calma que mantém Mail, Tasks e Build alinhados.",
    "dashboard.heroDescription": "A Presença Elly reserva o centro para contexto, clareza e a próxima melhor ação.",
    "dashboard.status.connected": "Ligado",
    "dashboard.status.context": "Contexto",
    "dashboard.status.latency": "Latência",
    "dashboard.kpi.tasksActive": "Tarefas ativas",
    "dashboard.kpi.helper.tasksActive": "Acompanhar fluxos da equipa.",
    "dashboard.kpi.agentsOnline": "Agentes online",
    "dashboard.kpi.helper.agentsOnline": "Todos os agentes prontos para transições.",
    "dashboard.kpi.queueHealth": "Saúde da fila",
    "dashboard.kpi.helper.queueHealth": "Processamento dentro da tolerância.",
    "dashboard.section.pipeline": "Pipeline de intenções",
    "dashboard.pipeline.step.analyze.title": "Analisar contexto",
    "dashboard.pipeline.step.analyze.description": "Elly absorve os sinais mais recentes antes das recomendações.",
    "dashboard.pipeline.step.optimize.title": "Otimizar fluxos",
    "dashboard.pipeline.step.optimize.description": "Ajustes são preparados para manter o workspace sossegado.",
    "dashboard.pipeline.step.deploy.title": "Implementar e monitorizar",
    "dashboard.pipeline.step.deploy.description": "As ações avançam enquanto Elly vigia variações e latência.",
    "dashboard.section.quickActions": "Ações rápidas",
    "dashboard.action.openMail": "Abrir Mail",
    "dashboard.action.openTasks": "Abrir Tasks",
    "dashboard.action.openBuildConsole": "Abrir consola Build",
    "dashboard.section.activity": "Atividade",
    "dashboard.activity.item.vendor.title": "Coordenação de fornecedores sinalizada",
    "dashboard.activity.item.vendor.detail": "O fornecedor principal ainda não respondeu; envie um lembrete.",
    "dashboard.activity.item.queue.title": "Fila sincronizada",
    "dashboard.activity.item.queue.detail": "24 tarefas aguardam para Ops, Vendas e Marketing.",
    "dashboard.activity.item.context.title": "Contexto atualizado",
    "dashboard.activity.item.context.detail": "Mail, calendário e Build estão alinhados com a intenção de hoje.",
    "dashboard.activity.timestamp.recent": "há 2 min",
    "dashboard.activity.timestamp.minutes": "há 17 min",
    "dashboard.activity.timestamp.hour": "Hoje · 10:02",
    "dashboard.empty.activity": "Sem atividade recente.",

    // Mail
    "mail.moduleLabel": "Correio",
    "mail.moduleSubtitle": "Gerir a caixa de entrada do workspace.",
    "mail.loadingTitle": "A carregar o correio",
    "mail.loadingSubtitle": "Aguarde enquanto carregamos as mensagens.",
    "mail.notConnectedTitle": "Correio não ligado",
    "mail.notConnectedSubtitle": "Ligue uma conta para ler emails.",
    "mail.connectedTitle": "Email ligado",
    "mail.connectedSubtitle":
      "Podes ler a caixa de entrada, abrir emails e pedir ao Elly para rascunhar respostas.",
    "mail.noAccessTitle": "Sem acesso ao correio",
    "mail.noAccessSubtitle": "Este workspace não tem permissões para o correio.",
    "mail.errorTitle": "Erro no correio",
    "mail.errorSubtitle": "Algo correu mal ao sincronizar o correio.",
    "mail.trashFailed": "Não foi possível mover a conversa para o lixo.",
    "mail.reload": "Recarregar",
    "mail.newMail": "Novo email",
    "mail.to": "Para",
    "mail.subject": "Assunto",
    "mail.message": "Mensagem",
    "mail.send": "Enviar",
    "mail.delete": "Eliminar",
    "mail.moveToTrash": "Mover para o lixo",
    "mail.archive": "Arquivar",
    "mail.inbox": "Caixa de entrada",
    "mail.sent": "Enviados",
    "mail.drafts": "Rascunhos",
    "mail.spam": "Spam",
    "mail.trashFolder": "Lixo",
    "mail.starred": "Com estrela",
    "mail.categories": "Categorias",
    "mail.category.promotions": "Promoções",
    "mail.category.social": "Social",
    "mail.category.updates": "Atualizações",
    "mail.category.forums": "Fóruns",
    "mail.labelsLoading": "A carregar etiquetas…",
    "mail.searchPlaceholder": "Pesquisar correio",
    "mail.more": "Mais",
    "mail.emptyInbox": "A sua caixa de entrada está vazia.",
    "mail.noResults": "Nenhuma conversa corresponde à pesquisa.",
    "mail.noSubject": "Sem assunto",
    "mail.unknownDate": "Data desconhecida",
    "mail.unknownSender": "Remetente desconhecido",
    "mail.noPreview": "Sem pré-visualização disponível",
    "mail.loadingMessage": "A carregar as mensagens…",
    "mail.selectThread": "Selecione uma conversa para ler.",
    "mail.connectOrSelect": "Ligue uma conta ou escolha um tópico.",
    "mail.messagesLabel": "mensagens",
    "mail.composeFillFields": "Preencha destinatário, assunto e mensagem.",
    "mail.composeSent": "Mensagem enviada",
    "mail.composeFailed": "Não foi possível enviar a mensagem.",
    "mail.emptySelect": "Seleciona um email para o ler.",
    "mail.reply": "Responder",
    "mail.forward": "Reencaminhar",
    "calendar.connectIcloud": "Conectar Calendário iCloud",
    "mail.connectIcloud": "Conectar Mail iCloud",

    // Elly
    "elly.label": "Elly",
    "elly.toggle": "Alternar painel do Elly",
    "elly.action": "Ação",
    "elly.execute": "Executar",
    "elly.hint": "Escolhe uma ação e clica em Executar.",
    "elly.options": "Opções",
    "elly.options.placeholder": "Opcional: tom, formato, pontos-chave, tamanho…",
    "elly.output.empty": "Ainda sem resultado. Escolhe uma ação e clica em Executar.",
    "elly.offlineBadge": "Modo offline",

    // Elly intents (Mail)
    "elly.intent.summarize": "Resumir",
    "elly.intent.draftReply": "Rascunhar resposta",
    "elly.intent.extractTasks": "Extrair tarefas",
    "elly.intent.desc.summarize": "Resumo curto do email",
    "elly.intent.desc.draftReply": "Resposta profissional pronta a enviar",
    "elly.intent.desc.extractTasks": "Transformar o email em tarefas",

    // Elly intents (Compose)
    "elly.compose.label": "Elly",
    "elly.compose.helper": "Ajuda-te a escrever mais rápido",
    "elly.compose.intent.writeDraft": "Escrever rascunho",
    "elly.compose.intent.shorten": "Tornar mais curto",
    "elly.compose.intent.toneFriendly": "Tom mais amigável",
    "elly.compose.intent.toneProfessional": "Tom mais profissional",
    "elly.compose.intent.polish": "Melhorar gramática",
  },

  hr: {
    // Common
    "common.close": "Zatvori",
    "common.save": "Spremi",
    "common.cancel": "Odustani",
    "common.done": "Gotovo",
    "common.loading": "Učitavanje…",
    "common.search": "Pretraži",
    "common.more": "Više",
    "common.back": "Natrag",
    "common.copy": "Kopiraj",
    "common.copied": "Kopirano",

    // Menu
    "menu.settings": "Postavke",
    "menu.help": "Pomoć",
    "menu.logout": "Odjava",
    "menu.copyId": "Kopiraj ID",

    // Settings nav
    "settings.title": "Postavke",
    "settings.general": "Općenito",
    "settings.notifications": "Obavijesti",
    "settings.personalization": "Personalizacija",
    "settings.apps": "Aplikacije",
    "settings.schedules": "Rasporedi",
    "settings.dataControls": "Kontrola podataka",
    "settings.security": "Sigurnost",
    "settings.parentalControls": "Roditeljske kontrole",
    "settings.account": "Račun",
    "settings.comingSoon": "Uskoro",

    // Settings: General
    "settings.appearance": "Izgled",
    "settings.appearance.system": "Sustav",
    "settings.appearance.light": "Svijetlo",
    "settings.appearance.dark": "Tamno",
    "settings.accentColor": "Boja naglaska",
    "settings.language": "Jezik",
    "settings.language.auto": "Automatski prepoznaj",
    "settings.language.en": "Engleski",
    "settings.language.de": "Njemački",
    "settings.language.pt": "Portugalski",
    "settings.language.hr": "Hrvatski",
    "settings.language.es": "Španjolski",
    "settings.language_option_auto": "Automatski prepoznaj",
    "settings.appearance_title": "Izgled",
    "settings.appearance_description": "Postavke teme i prikaza.",
    "settings.accent_color_title": "Boja naglaska",
    "settings.accent_color_help": "Naglasite workspace odabirom boje.",
    "settings.accent_color_copy": "Kopiraj HEX vrijednost",
    "settings.language_help": "Odaberi jezik sučelja.",

    // Settings: Admin
    "settings.admin_label": "Samo admin",
    "settings.admin_title": "Administratorske kontrole",
    "settings.admin_description": "Upravljaj članovima, dozvolama i identitetom.",
    "settings.admin_workspace": "Workspace admin",
    "settings.admin_members": "Tim / Članovi",
    "settings.admin_access": "Dozvole / Pristup",

    // Workspace nav
    "nav.dashboard": "Nadzorna ploča",
    "nav.calendar": "Kalendar",
    "nav.mail": "Pošta",
    "nav.tasks": "Zadaci",
    "nav.docsSlides": "Dokumenti i Slides",
    "nav.build": "Build",
    "nav.buildConsole": "Build konzola",
    "nav.automations": "Automatizacije",
    "nav.reasoning": "Razmišljanje",
    "nav.integrations": "Integracije",
    "nav.marketplace": "Marketplace",
    "nav.settings": "Postavke",
    "nav.sales": "Prodaja",
    "nav.hr": "HR",
    "nav.marketing": "Marketing",
    "nav.group.work": "Rad",
    "nav.group.business": "Poslovanje",
    "nav.group.build": "Build",

    // Dashboard
    "dashboard.heroLabel": "Elly prisutnost",
    "dashboard.title": "Kontrolni centar radnog prostora",
    "dashboard.subtitle": "Smirena inteligencija koja usklađuje Mail, Tasks i Build.",
    "dashboard.heroDescription": "Elly prisutnost čuva središnju traku za kontekst, jasnoću i sljedeći najbolji korak.",
    "dashboard.status.connected": "Povezano",
    "dashboard.status.context": "Kontekst",
    "dashboard.status.latency": "Latencija",
    "dashboard.kpi.tasksActive": "Aktivni zadaci",
    "dashboard.kpi.helper.tasksActive": "Praćenje timskih tokova.",
    "dashboard.kpi.agentsOnline": "Agentima online",
    "dashboard.kpi.helper.agentsOnline": "Svi agenti spremni za predaju.",
    "dashboard.kpi.queueHealth": "Zdravlje reda",
    "dashboard.kpi.helper.queueHealth": "Obrada ostaje unutar tolerancije.",
    "dashboard.section.pipeline": "Pipeline namjera",
    "dashboard.pipeline.step.analyze.title": "Analiziraj kontekst",
    "dashboard.pipeline.step.analyze.description": "Elly upija najnovije signale prije preporuka.",
    "dashboard.pipeline.step.optimize.title": "Optimiziraj tokove",
    "dashboard.pipeline.step.optimize.description": "Prilagodbe se planiraju kako bi radni prostor ostao smiren.",
    "dashboard.pipeline.step.deploy.title": "Implementiraj i prati",
    "dashboard.pipeline.step.deploy.description": "Radnje napreduju dok Elly prati odstupanja i latenciju.",
    "dashboard.section.quickActions": "Brze akcije",
    "dashboard.action.openMail": "Otvori Mail",
    "dashboard.action.openTasks": "Otvori Tasks",
    "dashboard.action.openBuildConsole": "Otvori Build konzolu",
    "dashboard.section.activity": "Aktivnost",
    "dashboard.activity.item.vendor.title": "Koordinacija dobavljača označena",
    "dashboard.activity.item.vendor.detail": "Glavni dobavljač još nije odgovorio; pošaljite podsjetnik.",
    "dashboard.activity.item.queue.title": "Red sinkroniziran",
    "dashboard.activity.item.queue.detail": "24 zadatka čekaju za Ops, Prodaju i Marketing.",
    "dashboard.activity.item.context.title": "Kontekst ažuriran",
    "dashboard.activity.item.context.detail": "Mail, kalendar i Build usklađeni su s današnjom namjerom.",
    "dashboard.activity.timestamp.recent": "prije 2 min",
    "dashboard.activity.timestamp.minutes": "prije 17 min",
    "dashboard.activity.timestamp.hour": "Danas · 10:02",
    "dashboard.empty.activity": "Još nema aktivnosti.",

    // Mail
    "mail.moduleLabel": "Pošta",
    "mail.moduleSubtitle": "Upravljaj inboxom workspacea.",
    "mail.loadingTitle": "Pošta se učitava",
    "mail.loadingSubtitle": "Pričekaj dok učitamo poruke.",
    "mail.notConnectedTitle": "Pošta nije povezana",
    "mail.notConnectedSubtitle": "Poveži račun za čitanje poruka.",
    "mail.connectedTitle": "Pošta povezana",
    "mail.connectedSubtitle":
      "Možeš čitati ulaznu poštu, otvarati e-poruke i zamoliti Elly da napiše odgovor.",
    "mail.noAccessTitle": "Nema pristupa pošti",
    "mail.noAccessSubtitle": "Workspace nema dozvole za poštu.",
    "mail.errorTitle": "Greška u pošti",
    "mail.errorSubtitle": "Došlo je do problema pri sinkronizaciji.",
    "mail.trashFailed": "Konverzaciju nije moguće premjestiti u smeće.",
    "mail.reload": "Učitaj ponovno",
    "mail.newMail": "Nova poruka",
    "mail.to": "Primatelj",
    "mail.subject": "Predmet",
    "mail.message": "Poruka",
    "mail.send": "Pošalji",
    "mail.delete": "Izbriši",
    "mail.moveToTrash": "Premjesti u smeće",
    "mail.archive": "Arhiviraj",
    "mail.inbox": "Ulazna pošta",
    "mail.sent": "Poslano",
    "mail.drafts": "Skice",
    "mail.spam": "Neželjena pošta",
    "mail.trashFolder": "Smeće",
    "mail.starred": "Označeno zvjezdicom",
    "mail.categories": "Kategorije",
    "mail.category.promotions": "Promocije",
    "mail.category.social": "Društveno",
    "mail.category.updates": "Ažuriranja",
    "mail.category.forums": "Forumi",
    "mail.labelsLoading": "Učitavaju se oznake…",
    "mail.searchPlaceholder": "Pretraži poštu",
    "mail.more": "Više",
    "mail.emptyInbox": "Inbox je prazan.",
    "mail.noResults": "Nema rezultata za tu pretragu.",
    "mail.noSubject": "Bez naslova",
    "mail.unknownDate": "Nepoznati datum",
    "mail.unknownSender": "Nepoznati pošiljatelj",
    "mail.noPreview": "Nema pretpregleda",
    "mail.loadingMessage": "Učitavaju se poruke…",
    "mail.selectThread": "Odaberi razgovor za čitanje.",
    "mail.connectOrSelect": "Poveži račun ili odaberi temu.",
    "mail.messagesLabel": "poruke",
    "mail.composeFillFields": "Ispuni primatelja, naslov i poruku.",
    "mail.composeSent": "Poruka poslana",
    "mail.composeFailed": "Nije moguće poslati poruku.",
    "mail.emptySelect": "Odaberi poruku za čitanje.",
    "mail.reply": "Odgovori",
    "mail.forward": "Proslijedi",
    "calendar.connectIcloud": "Poveži iCloud kalendar",
    "mail.connectIcloud": "Poveži iCloud Mail",

    // Elly
    "elly.label": "Elly",
    "elly.toggle": "Uključi/isključi Elly panel",
    "elly.action": "Radnja",
    "elly.execute": "Pokreni",
    "elly.hint": "Odaberi radnju i klikni Pokreni.",
    "elly.options": "Opcije",
    "elly.options.placeholder": "Opcionalno: ton, format, ključne točke, duljina…",
    "elly.output.empty": "Još nema rezultata. Odaberi radnju i klikni Pokreni.",
    "elly.offlineBadge": "Offline način",

    // Elly intents (Mail)
    "elly.intent.summarize": "Sažmi",
    "elly.intent.draftReply": "Napiši odgovor",
    "elly.intent.extractTasks": "Izdvoji zadatke",
    "elly.intent.desc.summarize": "Kratki sažetak e-poruke",
    "elly.intent.desc.draftReply": "Profesionalan odgovor spreman za slanje",
    "elly.intent.desc.extractTasks": "Pretvori e-poruku u zadatke",

    // Elly intents (Compose)
    "elly.compose.label": "Elly",
    "elly.compose.helper": "Pomaže ti brže pisati",
    "elly.compose.intent.writeDraft": "Napiši nacrt",
    "elly.compose.intent.shorten": "Skrati",
    "elly.compose.intent.toneFriendly": "Prijateljskiji ton",
    "elly.compose.intent.toneProfessional": "Profesionalniji ton",
    "elly.compose.intent.polish": "Uredi gramatiku",
  },

  es: {
    // Common
    "common.close": "Cerrar",
    "common.save": "Guardar",
    "common.cancel": "Cancelar",
    "common.done": "Listo",
    "common.loading": "Cargando…",
    "common.search": "Buscar",
    "common.more": "Más",
    "common.back": "Atrás",
    "common.copy": "Copiar",
    "common.copied": "Copiado",

    // Menu
    "menu.settings": "Ajustes",
    "menu.help": "Ayuda",
    "menu.logout": "Cerrar sesión",
    "menu.copyId": "Copiar ID",

    // Settings nav
    "settings.title": "Ajustes",
    "settings.general": "General",
    "settings.notifications": "Notificaciones",
    "settings.personalization": "Personalización",
    "settings.apps": "Apps",
    "settings.schedules": "Planes",
    "settings.dataControls": "Controles de datos",
    "settings.security": "Seguridad",
    "settings.parentalControls": "Control parental",
    "settings.account": "Cuenta",
    "settings.comingSoon": "Próximamente",

    // Settings: General
    "settings.appearance": "Apariencia",
    "settings.appearance.system": "Sistema",
    "settings.appearance.light": "Claro",
    "settings.appearance.dark": "Oscuro",
    "settings.accentColor": "Color de acento",
    "settings.language": "Idioma",
    "settings.language.auto": "Detectar automáticamente",
    "settings.language.en": "Inglés",
    "settings.language.de": "Alemán",
    "settings.language.pt": "Portugués",
    "settings.language.hr": "Croata",
    "settings.language.es": "Español",
    "settings.language_option_auto": "Detectar automáticamente",
    "settings.appearance_title": "Apariencia",
    "settings.appearance_description": "Preferencias de tema y visualización.",
    "settings.accent_color_title": "Color de acento",
    "settings.accent_color_help": "Elige un color para resaltar tu espacio de trabajo.",
    "settings.accent_color_copy": "Copiar el código",
    "settings.language_help": "Selecciona el idioma de la interfaz.",

    // Settings: Admin
    "settings.admin_label": "Solo administradores",
    "settings.admin_title": "Controles de administrador",
    "settings.admin_description": "Gestiona miembros, permisos e identidad.",
    "settings.admin_workspace": "Administrador del workspace",
    "settings.admin_members": "Equipo / Miembros",
    "settings.admin_access": "Permisos / Acceso",

    // Workspace nav
    "nav.dashboard": "Panel",
    "nav.calendar": "Calendario",
    "nav.mail": "Correo",
    "nav.tasks": "Tareas",
    "nav.docsSlides": "Docs y Slides",
    "nav.build": "Build",
    "nav.buildConsole": "Consola de Build",
    "nav.automations": "Automatizaciones",
    "nav.reasoning": "Razonamiento",
    "nav.integrations": "Integraciones",
    "nav.marketplace": "Marketplace",
    "nav.settings": "Ajustes",
    "nav.sales": "Ventas",
    "nav.hr": "RRHH",
    "nav.marketing": "Marketing",
    "nav.group.work": "Trabajo",
    "nav.group.business": "Negocios",
    "nav.group.build": "Build",

    // Dashboard
    "dashboard.heroLabel": "Presencia Elly",
    "dashboard.title": "Centro de control del workspace",
    "dashboard.subtitle": "Inteligencia calmada que mantiene Mail, Tasks y Build alineados.",
    "dashboard.heroDescription": "La Presencia Elly reserva el centro para contexto, claridad y la siguiente mejor acción.",
    "dashboard.status.connected": "Conectado",
    "dashboard.status.context": "Contexto",
    "dashboard.status.latency": "Latencia",
    "dashboard.kpi.tasksActive": "Tareas activas",
    "dashboard.kpi.helper.tasksActive": "Monitorea los flujos del equipo.",
    "dashboard.kpi.agentsOnline": "Agentes en línea",
    "dashboard.kpi.helper.agentsOnline": "Todos los agentes listos para ceder.",
    "dashboard.kpi.queueHealth": "Salud de la cola",
    "dashboard.kpi.helper.queueHealth": "Procesamiento dentro de la tolerancia.",
    "dashboard.section.pipeline": "Pipeline de intenciones",
    "dashboard.pipeline.step.analyze.title": "Analizar contexto",
    "dashboard.pipeline.step.analyze.description": "Elly absorbe las señales más recientes antes de sugerir recomendaciones.",
    "dashboard.pipeline.step.optimize.title": "Optimizar flujos",
    "dashboard.pipeline.step.optimize.description": "Se preparan ajustes para mantener la calma en el workspace.",
    "dashboard.pipeline.step.deploy.title": "Desplegar y supervisar",
    "dashboard.pipeline.step.deploy.description": "Las acciones avanzan mientras Elly vigila desviaciones y latencia.",
    "dashboard.section.quickActions": "Acciones rápidas",
    "dashboard.action.openMail": "Abrir Mail",
    "dashboard.action.openTasks": "Abrir Tasks",
    "dashboard.action.openBuildConsole": "Abrir consola Build",
    "dashboard.section.activity": "Actividad",
    "dashboard.activity.item.vendor.title": "Coordinación de proveedores señalada",
    "dashboard.activity.item.vendor.detail": "El proveedor principal aún no responde; envía un recordatorio.",
    "dashboard.activity.item.queue.title": "Cola sincronizada",
    "dashboard.activity.item.queue.detail": "24 tareas están en cola para Ops, Ventas y Marketing.",
    "dashboard.activity.item.context.title": "Contexto actualizado",
    "dashboard.activity.item.context.detail": "Mail, calendario y Build están alineados con la intención del día.",
    "dashboard.activity.timestamp.recent": "hace 2 min",
    "dashboard.activity.timestamp.minutes": "hace 17 min",
    "dashboard.activity.timestamp.hour": "Hoy · 10:02",
    "dashboard.empty.activity": "Aún no hay actividad reciente.",

    // Mail
    "mail.moduleLabel": "Correo",
    "mail.moduleSubtitle": "Gestiona la bandeja de tu workspace.",
    "mail.loadingTitle": "Cargando correo",
    "mail.loadingSubtitle": "Espera mientras cargamos tus mensajes.",
    "mail.notConnectedTitle": "Correo no conectado",
    "mail.notConnectedSubtitle": "Conecta una cuenta para leer correos.",
    "mail.connectedTitle": "Correo conectado",
    "mail.connectedSubtitle":
      "Puedes leer la bandeja de entrada, abrir correos y pedir a Elly que redacte respuestas.",
    "mail.noAccessTitle": "Sin acceso al correo",
    "mail.noAccessSubtitle": "Este workspace no tiene permisos para el correo.",
    "mail.errorTitle": "Error de correo",
    "mail.errorSubtitle": "Algo falló al sincronizar el correo.",
    "mail.trashFailed": "No se pudo mover la conversación a la papelera.",
    "mail.reload": "Recargar",
    "mail.newMail": "Nuevo correo",
    "mail.to": "Para",
    "mail.subject": "Asunto",
    "mail.message": "Mensaje",
    "mail.send": "Enviar",
    "mail.delete": "Eliminar",
    "mail.moveToTrash": "Mover a la papelera",
    "mail.archive": "Archivar",
    "mail.inbox": "Bandeja de entrada",
    "mail.sent": "Enviados",
    "mail.drafts": "Borradores",
    "mail.spam": "Spam",
    "mail.trashFolder": "Papelera",
    "mail.starred": "Destacados",
    "mail.categories": "Categorías",
    "mail.category.promotions": "Promociones",
    "mail.category.social": "Social",
    "mail.category.updates": "Actualizaciones",
    "mail.category.forums": "Foros",
    "mail.labelsLoading": "Cargando etiquetas…",
    "mail.searchPlaceholder": "Buscar correo",
    "mail.more": "Más",
    "mail.emptyInbox": "Tu bandeja está vacía.",
    "mail.noResults": "No hay conversaciones para esa búsqueda.",
    "mail.noSubject": "Sin asunto",
    "mail.unknownDate": "Fecha desconocida",
    "mail.unknownSender": "Remitente desconocido",
    "mail.noPreview": "Sin vista previa disponible",
    "mail.loadingMessage": "Cargando mensajes…",
    "mail.selectThread": "Selecciona una conversación para leerla.",
    "mail.connectOrSelect": "Conecta una cuenta o elige un hilo.",
    "mail.messagesLabel": "mensajes",
    "mail.composeFillFields": "Completa destinatario, asunto y mensaje.",
    "mail.composeSent": "Mensaje enviado",
    "mail.composeFailed": "No se pudo enviar el mensaje.",
    "mail.emptySelect": "Selecciona un correo para leerlo.",
    "mail.reply": "Responder",
    "mail.forward": "Reenviar",
    "calendar.connectIcloud": "Conectar Calendario iCloud",
    "mail.connectIcloud": "Conectar Mail iCloud",

    // Elly
    "elly.label": "Elly",
    "elly.toggle": "Alternar panel de Elly",
    "elly.action": "Acción",
    "elly.execute": "Ejecutar",
    "elly.hint": "Elige una acción y pulsa Ejecutar.",
    "elly.options": "Opciones",
    "elly.options.placeholder": "Opcional: tono, formato, puntos clave, longitud…",
    "elly.output.empty": "Aún no hay salida. Elige una acción y pulsa Ejecutar.",
    "elly.offlineBadge": "Modo sin conexión",

    // Elly intents (Mail)
    "elly.intent.summarize": "Resumir",
    "elly.intent.draftReply": "Redactar respuesta",
    "elly.intent.extractTasks": "Extraer tareas",
    "elly.intent.desc.summarize": "Resumen corto del correo",
    "elly.intent.desc.draftReply": "Respuesta profesional lista para enviar",
    "elly.intent.desc.extractTasks": "Convertir el correo en tareas",

    // Elly intents (Compose)
    "elly.compose.label": "Elly",
    "elly.compose.helper": "Te ayuda a escribir más rápido",
    "elly.compose.intent.writeDraft": "Escribir borrador",
    "elly.compose.intent.shorten": "Acortar",
    "elly.compose.intent.toneFriendly": "Tono más amable",
    "elly.compose.intent.toneProfessional": "Tono más profesional",
    "elly.compose.intent.polish": "Mejorar gramática",
  },
};

export const TRANSLATIONS = translations;
export type TranslationMap = typeof translations;
export type AppLanguageCode = keyof TranslationMap;
