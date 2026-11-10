# פריסה לענן: Render ו-Vercel

השרת (FastAPI) ומסד הנתונים (PostgreSQL) על Render, והאתר (React) על Vercel. Vercel ו-Render נותנים HTTPS אוטומטית. HTTPS נחוץ להכתבה ולמניעת כיבוי המסך בקיוסק.

## לפני שמתחילים

1. **שורש המאגר הוא `WAZE_MARKET`,** התיקייה שמכילה את `render.yaml`, `backend/` ו-`frontend/`. ב-GitHub הם צריכים להופיע ישר בעמוד הראשי של המאגר, בלי תיקייה עוטפת. אחרת Render לא ימצא את `backend` ויכשל עם "Root directory 'backend' does not exist".
2. **שום סוד לא נכנס למאגר.** `backend/.env` מוחרג ב-`.gitignore`. מפתחות מוזנים רק בלוחות הבקרה.

## שלב 1: השרת והמסד ב-Render

1. Render ← **New** ← **Blueprint** ← בוחרים את המאגר. הקובץ `render.yaml` יוצר שני רכיבים: `shefa-api` ו-`shefa-db`, שניהם בפרנקפורט.
2. Render ישאל על הערכים שמסומנים `sync: false`:
   - `OPENAI_API_KEY`: המפתח שלך. בלעדיו הכתבה וצילום רשימה כבויים, ושאר האפליקציה עובדת.
   - `CORS_ORIGINS`: אפשר להשאיר ריק עכשיו ולמלא בשלב 3.
   - `ANTHROPIC_API_KEY`, `CORS_ORIGIN_REGEX`: לא חובה.
3. אחרי שהשרת עולה: `https://shefa-api.onrender.com/health` צריך להחזיר `{"status":"ok"}`. הבדיקה הזו פונה גם למסד.
4. `ADMIN_TOKEN` נוצר אוטומטית. מעתיקים אותו מלוח הבקרה של Render (Environment). זה הקוד לכניסה ל-`/admin`.

## שלב 2: האתר ב-Vercel

1. Vercel ← **Add New Project** ← בוחרים את המאגר.
2. **Root Directory:** `frontend`. שאר ההגדרות באות מ-`frontend/vercel.json`.
3. **Environment Variables:** `VITE_BACKEND_URL` = כתובת השרת משלב 1, למשל `https://shefa-api.onrender.com`. הערך נצרב בזמן הבנייה, ולכן שינוי בו מחייב פריסה מחדש.
4. Deploy. הכתובות `/kiosk`, `/mobile` ו-`/admin` נפתחות ישירות.

## שלב 3: לחבר בין השניים

1. ב-Render, ב-`shefa-api`: `CORS_ORIGINS` = כתובת האתר ב-Vercel, למשל `https://shefa-sandy.vercel.app`. כמה כתובות מפרידים בפסיק. השרת חותך נתיב ו-`/` בסוף, כך שגם כתובת שהועתקה משורת הכתובת עובדת.
2. אם רוצים שגם כתובות התצוגה המקדימה של Vercel יעבדו: `CORS_ORIGIN_REGEX` = `https://shefa-[a-z0-9-]+-orimegeds-projects\.vercel\.app`. בלי שם הצוות בסוף, התבנית תאשר גם פרויקטים של אנשים אחרים ששמם מתחיל ב-`shefa-`.
3. שומרים עם **Save and deploy**. אחרי **Save only** השרת שרץ ממשיך עם הערך הישן. בלוג של ההפעלה מופיעה השורה `CORS allows: ...` עם הכתובות שבתוקף.

**"החיפוש לא זמין כרגע" כשהלוג של Render מראה 200:** הדפדפן קיבל תשובה בלי אישור CORS וזרק אותה. הכתובת שבשורת הכתובת של הדפדפן צריכה להופיע בשורה `CORS allows`.
4. בודקים: הקיוסק מציג מפה, ה-QR שבו פותח את `/mobile` בטלפון, ו-`/admin` מקבל את הקוד.

## שלב 4, לא חובה: נתוני הדגמה

ב-Render ← `shefa-api` ← **Shell**: `python seed_demo_data.py`. הסקריפט ממלא דוחות, חיפושים וטיולים מדומים, כולם מסומנים `demo-seed-`. לפני שנתונים אמיתיים של פיילוט מתחילים להצטבר: `python seed_demo_data.py --clear`.

## כל משתני הסביבה

### השרת (Render)

| משתנה | חובה | דוגמה | למה |
|---|---|---|---|
| `DATABASE_URL` | כן | מגיע מ-`shefa-db` | המלאי, הדוחות ולוח הבקרה. גם `postgres://` מתקבל |
| `ADMIN_TOKEN` | כן | נוצר אוטומטית | בלעדיו `/admin` נעול |
| `CORS_ORIGINS` | כן | `https://shefa.vercel.app` | אילו אתרים רשאים לפנות לשרת, כולל ה-WebSocket של ההכתבה |
| `OPENAI_API_KEY` | להכתבה ולצילום | `sk-...` | בלעדיו שתי היכולות כבויות |
| `PYTHON_VERSION` | כבר מוגדר | `3.13.1` | הגרסה שנבדקה |
| `FORWARDED_ALLOW_IPS` | כבר מוגדר | `*` | לסמוך על ה-proxy של Render |
| `STORE_TIMEZONE` | כבר מוגדר | `Asia/Jerusalem` | מתי "היום" מתחיל בלוח הבקרה |
| `CORS_ORIGIN_REGEX` | לא | ראו שלב 3 | כתובות תצוגה מקדימה |
| `ANTHROPIC_API_KEY` | לא | `sk-ant-...` | מיון שורות לא ברורות ברשימה |
| `LIST_PHOTO_MODEL`, `STT_MODEL`, `LLM_MODEL` | לא | | החלפת מודל |

### האתר (Vercel)

| משתנה | חובה | דוגמה | למה |
|---|---|---|---|
| `VITE_BACKEND_URL` | כן | `https://shefa-api.onrender.com` | לאן האתר שולח בקשות. ריק פירושו אותו דומיין |
| `VITE_PUBLIC_ORIGIN` | לא | `https://shefa.co.il` | כתובת אחרת ל-QR של הקיוסק, למשל דומיין משלכם |

## עם Supabase במקום Render Postgres

מוחקים מ-`render.yaml` את `databases` ואת `fromDatabase`, ומגדירים `DATABASE_URL` עם `sync: false`. לאחר מכן מדביקים את כתובת החיבור של Supabase. גם ה-pooler על פורט 6543 עובד, כי האפליקציה לא משתמשת ב-prepared statements.

## מגבלות ידועות

- **מופע אחד בלבד.** המיגרציות רצות כשהשרת עולה, ושני מופעים שעולים יחד עלולים להתנגש. הגבלת הקצב של ההכתבה נשמרת בזיכרון של כל מופע.
- **אין service worker.** הדף לא נטען מחדש בלי רשת. "נמצא" עובד גם בלי קליטה, כל עוד הדף לא נטען מחדש.
- **ההעלאות פתוחות.** הכתבה וצילום רשימה עולים כסף ב-OpenAI, ואין עליהם הגבלה לכל מכשיר. לפני פתיחה לקהל רחב כדאי להוסיף הגבלה, או לפחות תקרת הוצאה בחשבון OpenAI.
- **תוכניות חינמיות לא מתאימות כאן.** שירות חינמי נרדם אחרי 15 דקות, ומסד חינמי נמחק אחרי 30 יום.

## במחשב המקומי

לא משתנה כלום. `npm run dev` ו-`npm run demo:https` ממשיכים לעבוד דרך ה-proxy של vite, ו-`VITE_BACKEND_URL` נשאר ריק. בהפעלה הראשונה של הגרסה הזו, הדוחות והטיולים מ-`backend/var/events.sqlite3` מועתקים פעם אחת לתוך `backend/var/inventory.sqlite3`.
