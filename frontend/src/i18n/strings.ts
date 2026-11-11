import type { Side } from "../api/types";

export type Language = "he" | "en";

export const DEFAULT_LANGUAGE: Language = "he";

export interface Strings {
  direction: "rtl" | "ltr";
  appName: string;
  otherLanguageLabel: string;
  aisle: (aisleNo: number, side: Side) => string;
  /** For a narrow card, next to the zone badge. */
  aisleShort: (aisleNo: number, side: Side) => string;
  /** Where a category stands on a drawn floor plan, which has no aisles. */
  onShelf: (department: string) => string;
  notOnMap: string;
  searchLabel: string;
  searchPlaceholder: string;
  clearSearch: string;
  searching: string;
  noResults: (query: string) => string;
  searchFailed: string;
  browseCategories: string;
  addItem: (name: string) => string;
  alreadyAdded: (name: string) => string;
  removeItem: (name: string) => string;
  qrUnreachable: string;

  routeTitle: string;
  progress: (done: number, total: number) => string;
  nextStop: string;
  rightHere: string;
  metersAway: (meters: number) => string;
  allFound: string;
  allFoundHint: (meters: number) => string;
  toFindHeading: string;
  foundHeading: string;
  foundIt: string;
  notFoundHere: string;
  /** "Station 2 of 5". */
  stationOf: (number: number, total: number) => string;
  /** The station sheet's one big action: at the shelf, on to the next. */
  arrivedNext: string;
  /** The same at the last station, when what follows is the checkout. */
  arrivedLast: string;
  /** Under it, the station after this one. */
  thenStation: (name: string) => string;
  metersLeft: (meters: number) => string;
  stationSheet: string;
  showStations: (count: number) => string;
  hideStations: string;
  wholeStore: string;
  backToRoute: string;
  /** Back to the frame after the map was moved by hand, in the whole-store view. */
  recenter: string;
  searchMore: string;
  closeSearch: string;
  notFoundShort: string;
  notFoundItem: (name: string) => string;
  whichItemMissing: string;
  noneOfThem: string;
  notFoundThanks: (text: string) => string;
  missingHeading: string;
  foundAfterAll: string;
  routeFinished: (missing: number) => string;
  listComplete: string;
  updatingRoute: string;
  rerouteFailed: string;
  loadFailed: string;
  retry: string;
  entrance: string;
  checkout: string;
  mapLabel: string;


  otherLanguageShort: string;
  searchMobilePlaceholder: string;
  addAnyway: (text: string) => string;
  smartTitle: string;
  smartSubtitle: string;
  pasteList: string;
  pasteHint: string;
  pasteShort: string;
  listEntryWrite: string;
  listEntryPhoto: string;
  listEntryTitle: string;
  listEntryPlaceholder: string;
  addItems: (count: number) => string;
  photoReading: string;
  photoReview: string;
  photoUnreadable: string;
  photoUnavailable: string;
  micHint: string;
  departments: string;
  quickAdd: string;
  closePanel: string;
  listening: string;
  listeningHint: string;
  dictationStarting: string;
  dictationFinishing: string;
  dictationSegmentFailed: string;
  finishDictation: string;
  cancelDictation: string;
  startDictation: string;
  unmatchedHeading: string;
  pickDepartment: string;
  removeItemShort: (name: string) => string;
  matchingItems: (count: number) => string;
  resolveFailed: string;
  clearList: string;
  draftTitle: (count: number) => string;
  calculateRoute: (count: number) => string;
  clearConfirm: string;
  addedOne: (text: string, aisle: string) => string;
  addedUnknown: (text: string) => string;
  addedMany: (count: number, unmatched: number) => string;

  kioskScanTitle: string;
  kioskScanItems: string;
  quickSearchTitle: string;
  quickFull: string;
  quickClear: string;
  screenMaySleep: string;

  adminTitle: string;
  adminSubtitle: string;
  adminSignIn: string;
  adminTokenLabel: string;
  adminWrongToken: string;
  adminLocked: string;
  adminSignInFailed: string;
  adminSignOut: string;
  adminMapLabel: string;
  adminMapHint: string;
  zoneEmpty: string;
  zoneStocked: string;
  zoneLabel: (name: string, count: number) => string;
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
  zoneInventory: string;
  zoneIsEmpty: string;
  wholeCategory: (products: number) => string;
  moveItem: (name: string) => string;
  moveTo: string;
  deleteFromZone: (name: string) => string;
  deleteConfirm: (name: string) => string;
  saveFailed: string;
  addByText: string;
  addPlaceholder: string;
  addNewProduct: (name: string) => string;
  pickCategory: string;
  addExisting: (name: string) => string;
  dictateInventory: string;
  dictateHint: string;
  recording: (elapsed: string, limit: string) => string;
  stopRecording: string;
  cancelRecording: string;
  processingAudio: string;
  dictationDenied: string;
  dictationUnsupported: string;
  dictationUnavailable: string;
  dictationFailed: string;
  dictationEmpty: string;
  stagingTitle: string;
  stagingHint: string;
  heardTranscript: (text: string) => string;
  dictionaryOnly: string;
  itemName: string;
  removeStaged: (name: string) => string;
  approveItems: (count: number) => string;
  discardStaged: string;
  unsavedConfirm: string;
  itemsAdded: (count: number) => string;
  adminTabDashboard: string;
  mapPanelTitle: string;
  adminTabAlerts: string;
  adminTabFloorEditor: string;
  floorEditorTitle: string;
  floorEditorHint: string;
  floorTools: string;
  floorTiles: { aisle: string; shelf: string; wall: string; checkout: string; entrance: string };
  floorWalkable: string;
  floorBlocked: string;
  floorShelfLabel: string;
  floorShelfLabelPlaceholder: string;
  floorSize: string;
  floorUndo: string;
  floorClear: string;
  floorSave: string;
  floorSaved: string;
  floorSaveFailed: string;
  floorUnsaved: string;
  floorDepartments: string;
  floorNoDepartments: string;
  floorTileCount: (count: number) => string;
  floorUnlabelledShelves: (count: number) => string;
  floorCell: (row: number, col: number) => string;
  floorGridLabel: string;
  floorStats: (walkable: number, blocked: number) => string;
  floorJson: string;
  floorCopy: string;
  floorCopied: string;
  floorShortcuts: string;
  floorSaving: string;
  floorLoadFailed: string;
  floorCheckTitle: string;
  floorReady: string;
  floorProblems: { no_entrance: string; no_checkout: string; checkout_unreachable: string };
  floorUnreachable: (label: string) => string;
  /** A subcategory among the names to paint with: whose it is. */
  floorWithin: (department: string) => string;
  floorUnlinked: (label: string) => string;
  floorTileSize: string;
  floorTileSizeHint: (width: number, height: number) => string;
  floorTileSizeInvalid: (min: number, max: number) => string;
  metres: string;
  floorViewLabel: string;
  floorViewDrawn: string;
  floorViewZones: string;
  floorMapHint: string;
  alertsHint: string;
  alertsSummary: (count: number) => string;
  alertsEmpty: string;
  alertItem: string;
  alertCategory: string;
  alertTimes: string;
  alertLastReported: string;
  alertNeedsAction: string;
  alertNoCategory: string;
  alertActions: string;
  alertRestocked: string;
  alertUpdateLocation: string;
  alertResolveFailed: string;
  alertMoved: (item: string, zone: string) => string;
  alertMovedStillOpen: (item: string) => string;
  placingBanner: (item: string) => string;
  placingCancel: string;
  placingHint: (item: string) => string;
  kpiRoutesToday: string;
  kpiMissingAlerts: string;
  kpiUnfulfilled: string;
  kpiVsSameHours: string;
  kpiVsLastWeek: string;
  kpiVsPreviousWeek: string;
  kpiNew: string;
  kpiFlat: string;
  lostDemandTitle: string;
  lostDemandHint: (total: number) => string;
  lostDemandItems: string;
  lostDemandCategories: string;
  lostDemandEmpty: string;
  lostDemandOther: string;
  lostDemandNoCategory: string;
  lostDemandCenter: string;
  lostDemandTimes: (count: number) => string;
  layerHeat: string;
  layerTraffic: string;
  legendTrafficLow: string;
  legendTrafficHigh: string;
  legendHeat: string;
  trafficTrips: (count: number) => string;
}

function formatMetres(value: number, language: Language): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
}

export const strings: Record<Language, Strings> = {
  he: {
    direction: "rtl",
    appName: "מסלול קניות",
    otherLanguageLabel: "English",
    aisle: (aisleNo, side) => `מעבר ${aisleNo}, צד ${side === "left" ? "שמאל" : "ימין"}`,
    aisleShort: (aisleNo, side) => `מעבר ${aisleNo} · ${side === "left" ? "שמאל" : "ימין"}`,
    onShelf: (department) => `מדף ${department}`,
    notOnMap: "לא מסומן במפה",
    searchLabel: "חיפוש מוצר",
    searchPlaceholder: "למשל חלב, טחינה או קפה",
    clearSearch: "ניקוי החיפוש",
    searching: "מחפשים…",
    noResults: (query) => `לא מצאנו תוצאות עבור "${query}"`,
    searchFailed: "החיפוש לא זמין כרגע.",
    browseCategories: "או בוחרים מחלקה",
    addItem: (name) => `הוספת ${name} לרשימה`,
    alreadyAdded: (name) => `${name} כבר ברשימה`,
    removeItem: (name) => `הסרת ${name} מהרשימה`,
    qrUnreachable: "הקוד הזה לא ייפתח בטלפון. צריך להגדיר את כתובת הרשת של המחשב.",

    routeTitle: "המסלול שלך",
    progress: (done, total) => `${done} מתוך ${total}`,
    nextStop: "התחנה הבאה",
    rightHere: "ממש כאן",
    metersAway: (meters) => `${meters} מ׳ מכאן`,
    allFound: "הכול נמצא",
    allFoundHint: (meters) => `ממשיכים לקופות, ${meters} מ׳ מכאן`,
    toFindHeading: "נשאר למצוא",
    foundHeading: "נמצאו",
    foundIt: "נמצא",
    notFoundHere: "לא מצאתי כאן",
    stationOf: (number, total) => `תחנה ${number} מתוך ${total}`,
    arrivedNext: "הגעתי · הבא",
    arrivedLast: "הגעתי · לקופות",
    thenStation: (name) => `ואחריה: ${name}`,
    metersLeft: (meters) => `עוד ${meters} מ׳`,
    stationSheet: "התחנה הנוכחית",
    showStations: (count) => `כל התחנות (${count})`,
    hideStations: "הסתרת התחנות",
    wholeStore: "כל החנות",
    backToRoute: "חזרה למסלול",
    recenter: "מרכוז המפה",
    searchMore: "הוספת מוצר",
    closeSearch: "סגירת החיפוש",
    notFoundShort: "לא כאן",
    notFoundItem: (name) => `לא מצאתי כאן: ${name}`,
    whichItemMissing: "מה חסר במדף?",
    noneOfThem: "אף אחד מהם",
    notFoundThanks: (text) => `דיווחנו על ${text}. תודה!`,
    missingHeading: "לא נמצאו",
    foundAfterAll: "מצאתי בכל זאת",
    listComplete: "כל המוצרים נאספו!",
    routeFinished: (missing) => (missing === 1 ? "סיימנו, פריט אחד לא נמצא" : `סיימנו, ${missing} פריטים לא נמצאו`),
    updatingRoute: "מעדכנים מסלול",
    rerouteFailed: "לא הצלחנו לעדכן את המסלול.",
    loadFailed: "לא הצלחנו לטעון את המסלול.",
    retry: "ניסיון נוסף",
    entrance: "כניסה",
    checkout: "קופות",
    mapLabel: "מפת הסניף עם המסלול",


    otherLanguageShort: "EN",
    searchMobilePlaceholder: "מה מחפשים?",
    addAnyway: (text) => `הוספת "${text}" לרשימה`,
    smartTitle: "מה ברשימה?",
    smartSubtitle: "כותבים, מצלמים רשימה או מקישים על מחלקות.",
    pasteList: "הדבקת רשימה",
    pasteHint: "לוחצים לחיצה ארוכה על השדה ובוחרים הדבקה.",
    pasteShort: "הדבקה",
    listEntryWrite: "כתיבת רשימה",
    listEntryPhoto: "צילום רשימה",
    listEntryTitle: "הרשימה שלי",
    listEntryPlaceholder: "פריט בכל שורה, למשל:\nחלב\n2 לחם\nעגבניות",
    addItems: (count) =>
      count === 0
        ? "הוספה לרשימה"
        : count === 1
          ? "הוספת פריט אחד"
          : `הוספת ${count} פריטים`,
    photoReading: "קוראים את הרשימה…",
    photoReview: "זה מה שקראנו. אפשר לתקן לפני שמוסיפים.",
    photoUnreadable: "לא הצלחנו לקרוא את התמונה. אפשר לצלם שוב באור טוב יותר, או לכתוב כאן.",
    photoUnavailable: "צילום רשימה לא זמין כרגע. אפשר לכתוב או להדביק כאן.",
    micHint: "ההכתבה לא זמינה כרגע. לוחצים על שדה הטקסט ואז על המיקרופון במקלדת.",
    departments: "מחלקות",
    quickAdd: "הוספה מהירה",
    closePanel: "סגירה",
    listening: "מקשיבים",
    listeningHint: "אומרים פריט אחרי פריט. לא צריך למהר, מקשיבים עד שלוחצים סיום.",
    dictationStarting: "מפעילים את המיקרופון",
    dictationFinishing: "מסיימים לפענח",
    dictationSegmentFailed: "משהו לא נקלט. כדאי לחזור על הפריט האחרון.",
    finishDictation: "סיום",
    cancelDictation: "ביטול",
    startDictation: "הכתבה קולית",
    unmatchedHeading: "לא מצאנו בסניף",
    pickDepartment: "בחירת מחלקה",
    removeItemShort: (name) => `הסרת ${name}`,
    matchingItems: (count) => `מזהים ${count} פריטים`,
    resolveFailed: "לא הצלחנו לזהות את הפריטים.",
    clearList: "ניקוי הרשימה",
    draftTitle: (count) => (count === 1 ? "פריט אחד ברשימה" : `${count} פריטים ברשימה`),
    calculateRoute: (count) =>
      count === 1 ? "חישוב מסלול · פריט אחד" : `חישוב מסלול · ${count} פריטים`,
    clearConfirm: "למחוק את כל הרשימה?",
    addedOne: (text, aisle) => `נוסף: ${text} · ${aisle}`,
    addedUnknown: (text) => `נוסף: ${text}. לא מצאנו אותו בסניף.`,
    addedMany: (count, unmatched) =>
      unmatched > 0 ? `נוספו ${count} פריטים, ${unmatched} לא נמצאו` : `נוספו ${count} פריטים`,

    kioskScanTitle: "סורקים לרשימת הקניות המלאה ולמסלול. בלי להוריד אפליקציה!",
    kioskScanItems: "הפריטים שנבחרו יעברו לטלפון.",
    quickSearchTitle: "חיפוש מהיר (1 עד 3 פריטים)",
    quickFull: "הגעתם ל-3 פריטים. לעוד, סורקים את הקוד",
    quickClear: "מתחילים מחדש",
    screenMaySleep: "המסך עלול לכבות: שמירה על מסך דלוק דורשת HTTPS.",

    adminTitle: "ניהול הסניף",
    adminSubtitle: "מה נמצא על כל מדף. שינוי כאן מגיע ללקוחות מיד.",
    adminSignIn: "כניסה",
    adminTokenLabel: "קוד גישה",
    adminWrongToken: "קוד הגישה שגוי.",
    adminLocked: "הניהול נעול: לא הוגדר קוד גישה בשרת.",
    adminSignInFailed: "לא הצלחנו להתחבר לשרת.",
    adminSignOut: "יציאה",
    adminMapLabel: "מפת הסניף לעריכה",
    adminMapHint: "לוחצים על מדף כדי לנהל אותו. גוררים ומקרבים כדי לנוע במפה.",
    zoneEmpty: "מדף ריק",
    zoneStocked: "מדף עם מוצרים",
    zoneLabel: (name, count) => `${name}, ${count === 0 ? "ריק" : `${count} פריטים`}`,
    zoomIn: "קירוב",
    zoomOut: "הרחקה",
    zoomReset: "חזרה לתצוגה מלאה",
    zoneInventory: "מה יש כאן",
    zoneIsEmpty: "אין עדיין כלום במדף הזה.",
    wholeCategory: (products) =>
      products === 0 ? "מחלקה שלמה" : `מחלקה שלמה · ${products} מוצרים`,
    moveItem: (name) => `העברת ${name} למדף אחר`,
    moveTo: "העברה אל",
    deleteFromZone: (name) => `הסרת ${name} מהמדף`,
    deleteConfirm: (name) => `להסיר את ${name} מהמדף? לקוחות לא יישלחו לכאן יותר.`,
    saveFailed: "השינוי לא נשמר. בודקים את החיבור ומנסים שוב.",
    addByText: "הוספה בהקלדה",
    addPlaceholder: "שם מוצר או מחלקה",
    addNewProduct: (name) => `הוספת "${name}" כמוצר חדש`,
    pickCategory: "בוחרים מחלקה",
    addExisting: (name) => `הוספת ${name} למדף`,
    dictateInventory: "הכתבת מלאי",
    dictateHint: "הולכים לאורך המדף ואומרים בקול מה עומד עליו.",
    recording: (elapsed, limit) => `מקליטים ${elapsed} מתוך ${limit}`,
    stopRecording: "סיום הקלטה",
    cancelRecording: "ביטול",
    processingAudio: "מתמללים ומסדרים את הרשימה…",
    dictationDenied: "אין הרשאה למיקרופון. מאשרים אותה בהגדרות הדפדפן.",
    dictationUnsupported: "הדפדפן הזה לא יכול להקליט. אפשר להוסיף בהקלדה.",
    dictationUnavailable: "זיהוי הדיבור לא מוגדר בשרת. אפשר להוסיף בהקלדה.",
    dictationFailed: "שליחת ההקלטה נכשלה. ההקלטה נשמרה, אפשר לנסות שוב.",
    dictationEmpty: "לא שמענו מוצרים בהקלטה.",
    stagingTitle: "לבדיקה לפני שמירה",
    stagingHint: "מתקנים מה שצריך. שום דבר לא נשמר לפני האישור.",
    heardTranscript: (text) => `שמענו: "${text}"`,
    dictionaryOnly: "המחלקות הוצעו מהמילון בלבד, כדאי לעבור עליהן.",
    itemName: "שם המוצר",
    removeStaged: (name) => `הסרת ${name} מהרשימה לבדיקה`,
    approveItems: (count) => (count === 1 ? "אישור ושמירת פריט אחד" : `אישור ושמירת ${count} פריטים`),
    discardStaged: "ביטול הרשימה",
    unsavedConfirm: "יש פריטים שלא נשמרו. לסגור בכל זאת?",
    itemsAdded: (count) => (count === 1 ? "פריט אחד נשמר במדף." : `${count} פריטים נשמרו במדף.`),
    adminTabDashboard: "לוח בקרה",
    mapPanelTitle: "מפת הסניף",
    adminTabAlerts: "התראות מלאי על המדף",
    adminTabFloorEditor: "עורך מפה",
    floorEditorTitle: "עורך מפת הסניף",
    floorEditorHint: "בוחרים כלי וצובעים משבצות. גרירה צובעת ברצף, ולחיצה ימנית מוחקת.",
    floorTools: "כלים",
    floorTiles: { aisle: "מעבר", shelf: "מדף", wall: "קיר", checkout: "קופה", entrance: "כניסה" },
    floorWalkable: "אפשר לעבור",
    floorBlocked: "חוסם מעבר",
    floorShelfLabel: "המחלקה במדף",
    floorShelfLabelPlaceholder: "למשל מוצרי חלב",
    floorSize: "גודל הרשת (שורות × עמודות)",
    floorUndo: "ביטול",
    floorClear: "ניקוי המפה",
    floorSave: "שמירת המפה",
    floorSaved: "המפה נשמרה",
    floorSaveFailed: "השמירה נכשלה. נסו שוב.",
    floorUnsaved: "יש שינויים שלא נשמרו",
    floorDepartments: "מחלקות במפה",
    floorNoDepartments: "עוד אין מדפים עם מחלקה.",
    floorTileCount: (count) => (count === 1 ? "משבצת אחת" : `${count} משבצות`),
    floorUnlabelledShelves: (count) =>
      count === 1 ? "משבצת מדף אחת בלי מחלקה" : `${count} משבצות מדף בלי מחלקה`,
    floorCell: (row, col) => `שורה ${row}, עמודה ${col}`,
    floorGridLabel: "רשת המפה. החיצים מזיזים, רווח צובע ו-Delete מוחק.",
    floorStats: (walkable, blocked) => `${walkable} משבצות מעבר · ${blocked} חוסמות`,
    floorJson: "ה-JSON שנשלח לשרת",
    floorCopy: "העתקה",
    floorCopied: "הועתק",
    floorShortcuts: "1–5 בוחרים כלי · Ctrl+Z מבטל",
    floorSaving: "שומר…",
    floorLoadFailed: "לא הצלחנו לטעון את מפת הסניף.",
    floorCheckTitle: "בדיקת המפה השמורה",
    floorReady: "המפה מוכנה למסלולים.",
    floorProblems: {
      no_entrance: "חסרה כניסה במפה, ובלעדיה אין מאיפה להתחיל מסלול.",
      no_checkout: "חסרה קופה במפה, ובלעדיה אין איפה לסיים מסלול.",
      checkout_unreachable: "אין דרך מהכניסה אל הקופות.",
    },
    floorUnreachable: (label) => `אין גישה מהכניסה אל "${label}".`,
    floorWithin: (department) => `תת־קטגוריה של ${department}`,
    floorUnlinked: (label) =>
      `"${label}" לא תואם לאף מחלקה בקטלוג, ולכן רשימות של לקוחות לא יובילו אליו.`,
    floorTileSize: "גודל משבצת אחת בסניף",
    floorTileSizeHint: (width, height) =>
      `הסניף בציור: ${formatMetres(width, "he")} × ${formatMetres(height, "he")} מטרים`,
    floorTileSizeInvalid: (min, max) => `בין ${min} ל-${max} מטרים`,
    metres: "מ׳",
    floorViewLabel: "איזו מפה להציג",
    floorViewDrawn: "המפה המצוירת",
    floorViewZones: "אזורי מדף",
    floorMapHint: "תנועה ודיווחי \"לא מצאתי\" על המפה שציירתם. הצבת מוצרים נעשית באזורי המדף.",
    alertsHint: "מה לקוחות לא מצאו על המדף ב-7 הימים האחרונים.",
    alertsSummary: (count) =>
      count === 1 ? "פריט אחד דווח 3 פעמים או יותר." : `${count} פריטים דווחו 3 פעמים או יותר.`,
    alertsEmpty: "אין דיווחים ב-7 הימים האחרונים.",
    alertItem: "שם הפריט",
    alertCategory: "מחלקה",
    alertTimes: "דווח כחסר",
    alertLastReported: "דיווח אחרון",
    alertNeedsAction: "דורש טיפול",
    alertNoCategory: "לא ידוע",
    alertActions: "פעולות",
    alertRestocked: "מולא מחדש",
    alertUpdateLocation: "עדכן מיקום",
    alertResolveFailed: "הסימון לא נשמר. בודקים את החיבור ומנסים שוב.",
    alertMoved: (item, zone) => `המיקום של ${item} עודכן ל${zone}, וההתראה נסגרה.`,
    alertMovedStillOpen: (item) =>
      `המיקום של ${item} נשמר, אבל ההתראה נשארה פתוחה. אפשר לסגור אותה עם "מולא מחדש".`,
    placingBanner: (item) => `בוחרים במפה את המדף החדש של ${item}.`,
    placingCancel: "ביטול",
    placingHint: (item) =>
      `מיקום חדש עבור ${item}: הפריט יעבור למדף הזה, יוסר ממדפים אחרים וההתראה תיסגר.`,
    kpiRoutesToday: "מסלולים היום",
    kpiMissingAlerts: "התראות חוסר",
    kpiUnfulfilled: "חיפושים ללא מענה",
    kpiVsSameHours: "מול אותן שעות לפני שבוע",
    kpiVsLastWeek: "מול לפני שבוע",
    kpiVsPreviousWeek: "מול 7 הימים שלפני",
    kpiNew: "חדש",
    kpiFlat: "ללא שינוי",
    lostDemandTitle: "ביקוש שלא נענה",
    lostDemandHint: (total) => `${total} חיפושים ב-7 הימים האחרונים לא מצאו מוצר בקטלוג.`,
    lostDemandItems: "הפריטים המבוקשים ביותר",
    lostDemandCategories: "לפי מחלקה",
    lostDemandEmpty: "אין חיפושים ללא מענה ב-7 הימים האחרונים.",
    lostDemandOther: "אחר",
    lostDemandNoCategory: "ללא מחלקה",
    lostDemandCenter: "חיפושים",
    lostDemandTimes: (count) => (count === 1 ? "פעם אחת" : `${count} פעמים`),
    layerHeat: "מפת חום",
    layerTraffic: "זרימת תנועה",
    legendTrafficLow: "תנועה נמוכה",
    legendTrafficHigh: "תנועה גבוהה",
    legendHeat: "דיווחי חוסר פתוחים",
    trafficTrips: (count) => (count === 1 ? "מסלול אחד ב-7 ימים" : `${count} מסלולים ב-7 ימים`),
  },
  en: {
    direction: "ltr",
    appName: "Shopping Route",
    otherLanguageLabel: "עברית",
    aisle: (aisleNo, side) => `Aisle ${aisleNo}, ${side} side`,
    aisleShort: (aisleNo, side) => `Aisle ${aisleNo} · ${side}`,
    onShelf: (department) => `${department} shelf`,
    notOnMap: "Not on the map",
    searchLabel: "Search for a product",
    searchPlaceholder: "Try milk, tahini or coffee",
    clearSearch: "Clear search",
    searching: "Searching…",
    noResults: (query) => `No results for "${query}"`,
    searchFailed: "Search is unavailable right now.",
    browseCategories: "Or pick a department",
    addItem: (name) => `Add ${name} to the list`,
    alreadyAdded: (name) => `${name} is already on the list`,
    removeItem: (name) => `Remove ${name} from the list`,
    qrUnreachable: "This code won't open on a phone. Set the computer's network address.",

    routeTitle: "Your route",
    progress: (done, total) => `${done} of ${total}`,
    nextStop: "Next stop",
    rightHere: "Right here",
    metersAway: (meters) => `${meters} m away`,
    allFound: "Everything found",
    allFoundHint: (meters) => `Head to checkout, ${meters} m away`,
    toFindHeading: "Still to find",
    foundHeading: "Found",
    foundIt: "Found it",
    notFoundHere: "Not found here",
    stationOf: (number, total) => `Station ${number} of ${total}`,
    arrivedNext: "I'm here · Next",
    arrivedLast: "I'm here · Checkout",
    thenStation: (name) => `Then: ${name}`,
    metersLeft: (meters) => `${meters} m to go`,
    stationSheet: "Current station",
    showStations: (count) => `All stations (${count})`,
    hideStations: "Hide the stations",
    wholeStore: "Whole store",
    backToRoute: "Back to the route",
    recenter: "Recenter",
    searchMore: "Add an item",
    closeSearch: "Close search",
    notFoundShort: "Not here",
    notFoundItem: (name) => `Not found here: ${name}`,
    whichItemMissing: "What's missing from the shelf?",
    noneOfThem: "None of them",
    notFoundThanks: (text) => `Reported ${text}. Thanks!`,
    missingHeading: "Not found",
    foundAfterAll: "Found after all",
    listComplete: "All items collected!",
    routeFinished: (missing) => (missing === 1 ? "Done, 1 item not found" : `Done, ${missing} items not found`),
    updatingRoute: "Updating route",
    rerouteFailed: "We couldn't update the route.",
    loadFailed: "We couldn't load the route.",
    retry: "Try again",
    entrance: "Entrance",
    checkout: "Checkout",
    mapLabel: "Store map with your route",


    otherLanguageShort: "עב",
    searchMobilePlaceholder: "Find a product",
    addAnyway: (text) => `Add "${text}" to the list`,
    smartTitle: "What's on your list?",
    smartSubtitle: "Type, take a photo of a list, or tap departments.",
    pasteList: "Paste list",
    pasteHint: "Press and hold the field, then choose Paste.",
    pasteShort: "Paste",
    listEntryWrite: "Write a list",
    listEntryPhoto: "Photo of a list",
    listEntryTitle: "My list",
    listEntryPlaceholder: "One item per line, for example:\nmilk\n2 bread\ntomatoes",
    addItems: (count) =>
      count === 0 ? "Add to list" : count === 1 ? "Add 1 item" : `Add ${count} items`,
    photoReading: "Reading your list…",
    photoReview: "This is what we read. You can fix it before adding.",
    photoUnreadable: "We couldn't read that photo. Try again in better light, or type here.",
    photoUnavailable: "Photos of lists aren't available right now. You can type or paste here.",
    micHint: "Dictation isn't available right now. Tap a text field, then your keyboard's microphone.",
    departments: "Departments",
    quickAdd: "Quick add",
    closePanel: "Close",
    listening: "Listening",
    listeningHint: "Say one item after another. No rush, we listen until you tap Done.",
    dictationStarting: "Turning on the microphone",
    dictationFinishing: "Finishing up",
    dictationSegmentFailed: "Something didn't come through. Try the last item again.",
    finishDictation: "Done",
    cancelDictation: "Cancel",
    startDictation: "Voice dictation",
    unmatchedHeading: "Not found in this store",
    pickDepartment: "Pick a department",
    removeItemShort: (name) => `Remove ${name}`,
    matchingItems: (count) => `Matching ${count} items`,
    resolveFailed: "We couldn't match your items.",
    clearList: "Clear list",
    draftTitle: (count) => (count === 1 ? "1 item on your list" : `${count} items on your list`),
    calculateRoute: (count) =>
      count === 1 ? "Calculate Route · 1 item" : `Calculate Route · ${count} items`,
    clearConfirm: "Delete the whole list?",
    addedOne: (text, aisle) => `Added: ${text} · ${aisle}`,
    addedUnknown: (text) => `Added: ${text}. We couldn't find it in this store.`,
    addedMany: (count, unmatched) =>
      unmatched > 0 ? `Added ${count} items, ${unmatched} not found` : `Added ${count} items`,

    kioskScanTitle: "Scan for your full shopping list & route - No App Needed!",
    kioskScanItems: "The items you picked come along to your phone.",
    quickSearchTitle: "Quick Search (1-3 items)",
    quickFull: "That's 3 items. For more, scan the code",
    quickClear: "Start over",
    screenMaySleep: "The screen may turn off: keeping it on needs HTTPS.",

    adminTitle: "Store management",
    adminSubtitle: "What stands on each shelf. Changes reach shoppers right away.",
    adminSignIn: "Sign in",
    adminTokenLabel: "Access code",
    adminWrongToken: "That access code is wrong.",
    adminLocked: "Management is locked: the server has no access code set.",
    adminSignInFailed: "We couldn't reach the server.",
    adminSignOut: "Sign out",
    adminMapLabel: "Editable store map",
    adminMapHint: "Click a shelf to manage it. Drag and zoom to move around.",
    zoneEmpty: "Empty shelf",
    zoneStocked: "Stocked shelf",
    zoneLabel: (name, count) => `${name}, ${count === 0 ? "empty" : `${count} items`}`,
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomReset: "Back to the full map",
    zoneInventory: "On this shelf",
    zoneIsEmpty: "Nothing on this shelf yet.",
    wholeCategory: (products) =>
      products === 0 ? "Whole department" : `Whole department · ${products} products`,
    moveItem: (name) => `Move ${name} to another shelf`,
    moveTo: "Move to",
    deleteFromZone: (name) => `Remove ${name} from this shelf`,
    deleteConfirm: (name) => `Remove ${name} from this shelf? Shoppers won't be sent here for it.`,
    saveFailed: "That wasn't saved. Check the connection and try again.",
    addByText: "Add by typing",
    addPlaceholder: "Product or department name",
    addNewProduct: (name) => `Add "${name}" as a new product`,
    pickCategory: "Choose a department",
    addExisting: (name) => `Add ${name} to this shelf`,
    dictateInventory: "Dictate inventory",
    dictateHint: "Walk along the shelf and say what stands on it.",
    recording: (elapsed, limit) => `Recording ${elapsed} of ${limit}`,
    stopRecording: "Finish recording",
    cancelRecording: "Cancel",
    processingAudio: "Transcribing and sorting the list…",
    dictationDenied: "No microphone permission. Allow it in the browser settings.",
    dictationUnsupported: "This browser can't record. You can add items by typing.",
    dictationUnavailable: "Speech recognition isn't set up on the server. You can add by typing.",
    dictationFailed: "Sending the recording failed. It's kept, so you can try again.",
    dictationEmpty: "We didn't hear any products in that recording.",
    stagingTitle: "Review before saving",
    stagingHint: "Fix what needs fixing. Nothing is saved until you approve.",
    heardTranscript: (text) => `We heard: "${text}"`,
    dictionaryOnly: "Departments were suggested by the dictionary alone, so check them.",
    itemName: "Product name",
    removeStaged: (name) => `Remove ${name} from the review list`,
    approveItems: (count) => (count === 1 ? "Approve and save 1 item" : `Approve and save ${count} items`),
    discardStaged: "Discard list",
    unsavedConfirm: "Some items aren't saved. Close anyway?",
    itemsAdded: (count) => (count === 1 ? "1 item saved to this shelf." : `${count} items saved to this shelf.`),
    adminTabDashboard: "Dashboard",
    mapPanelTitle: "Store map",
    adminTabAlerts: "Shelf Stock Alerts",
    adminTabFloorEditor: "Map Editor",
    floorEditorTitle: "Store layout editor",
    floorEditorHint: "Pick a tool and paint tiles. Drag to paint a run; right-click erases.",
    floorTools: "Tools",
    floorTiles: { aisle: "Aisle", shelf: "Shelf", wall: "Wall", checkout: "Checkout", entrance: "Entrance" },
    floorWalkable: "Walkable",
    floorBlocked: "Blocks the way",
    floorShelfLabel: "Department on the shelf",
    floorShelfLabelPlaceholder: "e.g. Dairy",
    floorSize: "Grid size (rows × columns)",
    floorUndo: "Undo",
    floorClear: "Clear map",
    floorSave: "Save map",
    floorSaved: "Map saved",
    floorSaveFailed: "Couldn't save. Try again.",
    floorUnsaved: "Unsaved changes",
    floorDepartments: "Departments on the map",
    floorNoDepartments: "No shelves with a department yet.",
    floorTileCount: (count) => (count === 1 ? "1 tile" : `${count} tiles`),
    floorUnlabelledShelves: (count) =>
      count === 1 ? "1 shelf tile without a department" : `${count} shelf tiles without a department`,
    floorCell: (row, col) => `Row ${row}, column ${col}`,
    floorGridLabel: "Map grid. Arrows move, Space paints, Delete erases.",
    floorStats: (walkable, blocked) => `${walkable} walkable tiles · ${blocked} blocked`,
    floorJson: "JSON sent to the server",
    floorCopy: "Copy",
    floorCopied: "Copied",
    floorShortcuts: "1–5 pick a tool · Ctrl+Z undoes",
    floorSaving: "Saving…",
    floorLoadFailed: "We couldn't load the store layout.",
    floorCheckTitle: "Saved map check",
    floorReady: "The map is ready for routes.",
    floorProblems: {
      no_entrance: "The map has no entrance, so a route has nowhere to start.",
      no_checkout: "The map has no checkout, so a route has nowhere to end.",
      checkout_unreachable: "There's no way from the entrance to the checkouts.",
    },
    floorUnreachable: (label) => `"${label}" can't be reached from the entrance.`,
    floorWithin: (department) => `Within ${department}`,
    floorUnlinked: (label) =>
      `"${label}" doesn't match a catalog department, so shoppers' lists won't lead there.`,
    floorTileSize: "One tile on the store floor",
    floorTileSizeHint: (width, height) =>
      `The drawing covers ${formatMetres(width, "en")} × ${formatMetres(height, "en")} metres`,
    floorTileSizeInvalid: (min, max) => `Between ${min} and ${max} metres`,
    metres: "m",
    floorViewLabel: "Which map to show",
    floorViewDrawn: "Drawn map",
    floorViewZones: "Shelf zones",
    floorMapHint: "Traffic and \"not found\" reports on the map you drew. Products are placed in the shelf zones.",
    alertsHint: "What shoppers couldn't find on the shelf in the last 7 days.",
    alertsSummary: (count) =>
      count === 1 ? "1 item reported 3 times or more." : `${count} items reported 3 times or more.`,
    alertsEmpty: "No reports in the last 7 days.",
    alertItem: "Item Name",
    alertCategory: "Category",
    alertTimes: "Times Reported Missing",
    alertLastReported: "Last Reported Time",
    alertNeedsAction: "Needs attention",
    alertNoCategory: "Unknown",
    alertActions: "Actions",
    alertRestocked: "Restocked",
    alertUpdateLocation: "Update Location",
    alertResolveFailed: "That wasn't saved. Check the connection and try again.",
    alertMoved: (item, zone) => `${item} now points to ${zone}, and its alert is closed.`,
    alertMovedStillOpen: (item) =>
      `The location of ${item} was saved, but its alert is still open. You can close it with Restocked.`,
    placingBanner: (item) => `Choose the new shelf for ${item} on the map.`,
    placingCancel: "Cancel",
    placingHint: (item) =>
      `New location for ${item}: it moves to this shelf, leaves any others, and its alert closes.`,
    kpiRoutesToday: "Total Routes Today",
    kpiMissingAlerts: "Missing Alerts",
    kpiUnfulfilled: "Unfulfilled Searches",
    kpiVsSameHours: "vs the same hours last week",
    kpiVsLastWeek: "vs a week ago",
    kpiVsPreviousWeek: "vs the previous 7 days",
    kpiNew: "New",
    kpiFlat: "No change",
    lostDemandTitle: "Lost Demand",
    lostDemandHint: (total) => `${total} searches in the last 7 days found nothing in the catalog.`,
    lostDemandItems: "Most wanted items",
    lostDemandCategories: "By department",
    lostDemandEmpty: "No unfulfilled searches in the last 7 days.",
    lostDemandOther: "Other",
    lostDemandNoCategory: "No department",
    lostDemandCenter: "searches",
    lostDemandTimes: (count) => (count === 1 ? "Once" : `${count} times`),
    layerHeat: "Heatmap",
    layerTraffic: "Traffic Flow",
    legendTrafficLow: "Low Traffic",
    legendTrafficHigh: "High Traffic",
    legendHeat: "Open missing reports",
    trafficTrips: (count) => (count === 1 ? "1 route in 7 days" : `${count} routes in 7 days`),
  },
};
