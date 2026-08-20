import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const htmlPath = path.join(__dirname, "beyondmath-system-guide.html");
  const pdfPath = path.join(__dirname, "BeyondMath-系統使用與維護指南.pdf");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", right: "12mm", bottom: "14mm", left: "12mm" },
  });
  await browser.close();
  console.log("Wrote", pdfPath);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
