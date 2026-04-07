import express from "express";
import cors from "cors";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();
const app = express();
const upload = multer({
 storage: multer.memoryStorage(),
 limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
app.use(cors({
 origin: [
   "https://rezepttermin.vercel.app",
   "http://localhost:5173"
 ]
}));
app.use(express.json());
const SYSTEM_PROMPT = `Du bist ein spezialisierter OCR-Assistent für deutsche Heilmittelverordnungen.
Analysiere das Bild. Falls mehrere Rezepte sichtbar sind, nimm das vorderste.
Antworte NUR mit einem validen JSON-Objekt, ohne Markdown, ohne Erklärungen.
Schema:
{
 "formulartyp": "Muster13"|"Muster14"|"Vordr9"|"UV-Verordnung"|"PKV-Privatrezept"|"Unbekannt",
 "kostentraeger_typ": "GKV"|"PKV"|"UV"|"Unbekannt",
 "krankenkasse": string|null,
 "heilmittel": [{"bezeichnung":string,"behandlungseinheiten":number|null,"dauer_minuten":number|null,"ergaenzend":boolean,"konfidenz":"hoch"|"mittel"|"niedrig"}],
 "frequenz_min_pro_woche": number|null,
 "frequenz_max_pro_woche": number|null,
 "flags": {"hausbesuch":boolean,"dringlich_14_tage":boolean,"therapiebericht":boolean},
 "diagnose": {"icd10":string|null,"text":string|null,"diagnosegruppe":string|null},
 "ausstellungsdatum": string|null,
 "gesamtkonfidenz": "hoch"|"mittel"|"niedrig",
 "manuelle_pruefung_noetig": boolean
}`;
// Gesundheits-Check
app.get("/health", (req, res) => {
 res.json({ status: "ok", timestamp: new Date().toISOString() });
});
// Haupt-Endpunkt: Rezept analysieren
app.post("/analyze", upload.single("rezept"), async (req, res) => {
 if (!req.file) {
   return res.status(400).json({ error: "Kein Bild hochgeladen" });
 }
 try {
   // Bild als Base64
   const base64 = req.file.buffer.toString("base64");
   const mediaType = req.file.mimetype || "image/jpeg";
   // Claude aufrufen
   const response = await client.messages.create({
     model: "claude-sonnet-4-20250514",
     max_tokens: 1000,
     system: SYSTEM_PROMPT,
     messages: [{
       role: "user",
       content: [
         { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
         { type: "text", text: "Analysiere dieses Rezept." }
       ]
     }]
   });
   // JSON parsen
   const text = response.content.map(b => b.text || "").join("");
   const clean = text.replace(/```json|```/g, "").trim();
   const result = JSON.parse(clean);
   // Bild ist nie gespeichert worden (memoryStorage) — DSGVO-konform
   res.json({ success: true, data: result });
 } catch (error) {
   console.error("Analyse-Fehler:", error.message);
   res.status(500).json({ error: "Analyse fehlgeschlagen", details: error.message });
 }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
 console.log(`RezeptTermin API läuft auf Port ${PORT}`);
});
