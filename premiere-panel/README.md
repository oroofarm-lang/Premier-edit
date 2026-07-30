# Premier Edit — פאנל UXP לפרמייר (שלב 1: שלד הליכה)

זהו החלק הראשון של Stage 2 (`docs/superpowers/specs/2026-07-30-stage2-live-panel-design.md`): פאנל שרץ *בתוך* פרמייר, לא ייבוא/ייצוא XML. השלב הזה עדיין לא מבצע עריכות — הוא רק מוכיח שהחיבור עובד: קורא את הפרויקט הפעיל, הסיקוונס הפעיל, ורשימת הקליפים בטראק וידאו 1.

## איך לטעון את זה בפרמייר

1. **הפעלת Developer Mode:** בפרמייר Pro → Settings → Plugins → Enable Developer Mode (ואז לרוב צריך להפעיל את פרמייר מחדש).
2. **פתיחת UXP Developer Tool** (אפליקציה נפרדת מ-Adobe — אם אין אותה מותקנת, אפשר מ-Creative Cloud Desktop → Stock & Marketplace → Developer Tools, או מ-developer.adobe.com/uxp).
3. ב-UXP Developer Tool: **Add Plugin** → לבחור את הקובץ `manifest.json` בתיקייה הזו (`premiere-panel/manifest.json`).
4. ללחוץ **Load** (או **Load & Watch** כדי שכל שינוי בקבצים ייטען מחדש אוטומטית בלי לחזור ל-UXP Developer Tool).
5. בפרמייר: **Window → UXP Plugins → Premier Edit** — הפאנל צריך להופיע.

## מה אמורים לראות

- אם יש פרויקט פתוח בפרמייר: שם הפרויקט.
- אם יש סיקוונס פעיל: שם הסיקוונס, ורשימת הקליפים שבטראק וידאו 1 עם זמני התחלה/סוף.
- כפתור **Refresh** — לוחצים אחרי שמחליפים סיקוונס או פותחים פרויקט אחר.
- אם משהו לא עובד, ההודעה למעלה (`status`) תגיד למה (למשל "No project open in Premiere").

## מה זה *לא* עושה (עדיין)

זה שלד קריאה-בלבד. שום כתיבה לפרויקט, שום ביצוע של תוכנית עריכה. זה מגיע בשלב הבא (Phase 2): הרצת ה-`CutClip[]` המאושר מהפייפליין הקיים ישירות על הסיקוונס, כמו שמתואר בספסיפיקציה.

## מקור ה-API

הקוד נכתב מול ה-API האמיתי של פרמייר UXP (`require("premierepro")`), לא בהמצאה — נבדק מול הדוגמאות הרשמיות של אדובי ב-[AdobeDocs/uxp-premiere-pro-samples](https://github.com/AdobeDocs/uxp-premiere-pro-samples) (`sample-panels/metadata-handler`, `sample-panels/premiere-api`) לפני הכתיבה, כדי לא להמר על שמות פונקציות. `manifest.json` בנוי לפי אותה דוגמה (host כמערך, manifestVersion 5, minVersion 25.2.0).

**עדיין לא נבדק בפרמייר אמיתי** — זה השלב שממתין לך.
