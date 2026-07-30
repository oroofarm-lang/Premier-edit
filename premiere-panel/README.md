# Premier Edit — פאנל UXP לפרמייר

זה Stage 2 (`docs/superpowers/specs/2026-07-30-stage2-live-panel-design.md`): פאנל שרץ *בתוך* פרמייר במקום לייצא XML ולייבא ידנית.

מה הוא עושה:
1. **קורא** מה פתוח כרגע בפרמייר (פרויקט + סיקוונס פעיל).
2. **טוען תוכנית עריכה מאושרת** מהאפליקציה המקומית (Next.js) — אותה תוכנית שה-XML היה מייצא.
3. **בונה סיקוונס חדש** בפרמייר לפי התוכנית — מייבא קבצים חסרים, חותך כל קליפ ל-in/out המתוכנן, וממקם אותו בזמן המדויק. אחרי אישור אחד מפורש.

## הרצה — לפי הסדר

### 1. להפעיל את האפליקציה על פורט 3002

הפאנל מצפה למצוא את האפליקציה ב-`http://localhost:3002` (מוגדר ב-`manifest.json` תחת `requiredPermissions.network.domains`, ובקבוע `APP_ORIGIN` ב-`build-sequence.js` — אם אתה משנה פורט, צריך לשנות בשני המקומות).

```bash
npm run dev -- -p 3002
```

### 2. להפעיל Developer Mode בפרמייר

פרמייר Pro → Settings → Plugins → Enable Developer Mode (ואז להפעיל את פרמייר מחדש).

### 3. לטעון את הפאנל

ב-**UXP Developer Tool** (אפליקציה נפרדת של אדובי; אם אינה מותקנת — מ-Creative Cloud Desktop → Stock & Marketplace → Developer Tools):

1. **Add Plugin** → לבחור את `premiere-panel/manifest.json`.
2. **Load** (או **Load & Watch** כדי שכל שינוי בקוד ייטען אוטומטית).
3. בפרמייר: **Window → UXP Plugins → Premier Edit**.

### 4. להשתמש

1. לפתוח בפרמייר את הפרויקט שאליו רוצים לבנות (הפאנל בונה סיקוונס **חדש** בתוך הפרויקט הפתוח — לא נוגע בסיקוונסים קיימים).
2. בפאנל: לבחור פרויקט מהרשימה → **Load plan**.
3. לעבור על רשימת הקליפים שמוצגת (שם קובץ, in/out במקור, מיקום בטיימליין).
4. **Build sequence** → יופיע דיאלוג אישור → **Build**.

## מה לצפות לראות

- למעלה: שם הפרויקט הפתוח בפרמייר + הסיקוונס הפעיל.
- אחרי Load plan: סיכום (`N clips · Xs · fps · רזולוציה`) ורשימת הקליפים.
- אחרי Build: סיקוונס חדש בשם `<שם הפרויקט> (Premier Edit)` נפתח אוטומטית, ולוג בתחתית הפאנל שמראה כל קליפ שהונח.
- כל שגיאה מוצגת בשורת ה-status למעלה, לא נעלמת בשקט.

## מה זה עוד לא עושה

- **החלקת אודיו בין חיתוכים.** התוכנית כן מחזיקה `audioInSec`/`audioOutSec` (פריימים עודפים לצורך זה), אבל ל-UXP אין API להוספת מעבר אודיו — נבדק מול ה-type definitions האמיתיים של `@adobe/premierepro` v26.3.0: קיים `TransitionFactory` לווידאו בלבד. הדרך שכן אפשרית היא keyframes של ווליום דרך `AudioComponentChain`, וזה עדיין לא מומש. **בינתיים, ייצוא ה-XML הוא הדרך היחידה לקבל קרוספייד אודיו אמיתי** (`KGAudioTransCrossFade3dB`).
- אין Chat Edit (פקודות בשפה חופשית מול טיימליין חי) — מכוון, ראה את הספסיפיקציה.
- אין אריזה/הפצה — טעינה ב-dev mode בלבד.

## הערה על אמינות ה-API

כל קריאות ה-API נכתבו מול המקורות האמיתיים ולא בניחוש: הדוגמאות הרשמיות של אדובי ב-[AdobeDocs/uxp-premiere-pro-samples](https://github.com/AdobeDocs/uxp-premiere-pro-samples), וה-type definitions מ-`npm pack @adobe/premierepro@26.3.0` (4675 שורות `.d.ts`). זה מה שחשף שאין API למעברי אודיו, ואת החתימות הנכונות (`ClipProjectItem.cast()`, `createSetInOutPointsAction`, `SequenceEditor.getEditor().createOverwriteItemAction()`, וכל כתיבה חייבת לעבור דרך `project.lockedAccess()` + `project.executeTransaction()`).

**עדיין לא נבדק בפרמייר אמיתי** — זה השלב שממתין לך. שינויים בטיימליין עוברים כטרנזאקציה אחת, כך ש-Cmd+Z אחד מבטל את כל הבנייה.
