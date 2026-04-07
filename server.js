import express from "express";
import cors from "cors";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(cors({ origin: ["https://rezepttermin.vercel.app", "http://localhost:5173"] }));
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

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── Rezept analysieren ────────────────────────────────────────────────────────
app.post("/analyze", upload.single("rezept"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Kein Bild hochgeladen" });
  try {
    const base64 = req.file.buffer.toString("base64");
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 1000, system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: req.file.mimetype || "image/jpeg", data: base64 } },
        { type: "text", text: "Analysiere dieses Rezept." }
      ]}]
    });
    const text = response.content.map(b => b.text || "").join("");
    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: "Analyse fehlgeschlagen", details: error.message });
  }
});

// ── Mitarbeiter ───────────────────────────────────────────────────────────────
app.get("/mitarbeiter", async (req, res) => {
  const { data, error } = await supabase.from("mitarbeiter").select("*").order("name");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/mitarbeiter", async (req, res) => {
  const { data, error } = await supabase.from("mitarbeiter").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put("/mitarbeiter/:id", async (req, res) => {
  const { data, error } = await supabase.from("mitarbeiter").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete("/mitarbeiter/:id", async (req, res) => {
  const { error } = await supabase.from("mitarbeiter").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Patienten ─────────────────────────────────────────────────────────────────
app.get("/patienten", async (req, res) => {
  const { data, error } = await supabase.from("patienten").select("*").order("nachname");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/patienten", async (req, res) => {
  const { data, error } = await supabase.from("patienten").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put("/patienten/:id", async (req, res) => {
  const { data, error } = await supabase.from("patienten").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete("/patienten/:id", async (req, res) => {
  const { error } = await supabase.from("patienten").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Termine ───────────────────────────────────────────────────────────────────
app.get("/termine", async (req, res) => {
  const { data, error } = await supabase.from("termine").select("*").order("datum").order("start_zeit");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/termine", async (req, res) => {
  const { data, error } = await supabase.from("termine").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put("/termine/:id", async (req, res) => {
  const { data, error } = await supabase.from("termine").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete("/termine/:id", async (req, res) => {
  const { error } = await supabase.from("termine").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Urlaub ────────────────────────────────────────────────────────────────────
app.get("/urlaub", async (req, res) => {
  const { data, error } = await supabase.from("urlaub").select("*").order("von");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/urlaub", async (req, res) => {
  const { data, error } = await supabase.from("urlaub").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put("/urlaub/:id", async (req, res) => {
  const { data, error } = await supabase.from("urlaub").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete("/urlaub/:id", async (req, res) => {
  const { error } = await supabase.from("urlaub").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rezeptor API läuft auf Port ${PORT}`));
