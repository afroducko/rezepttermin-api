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

async function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Nicht angemeldet" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Ungültiger Token" });
  req.user = user;
  req.supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: "Bearer " + token } }
  });
  next();
}

async function adminOnly(req, res, next) {
  const { data } = await req.supabase.from("user_profiles").select("rolle").eq("id", req.user.id).single();
  if (data?.rolle !== "admin") return res.status(403).json({ error: "Nur fuer Admins" });
  next();
}

const SYSTEM_PROMPT = `Du bist ein spezialisierter OCR-Assistent fuer deutsche Heilmittelverordnungen.
Analysiere das Bild. Falls mehrere Rezepte sichtbar sind, nimm das vorderste.
Antworte NUR mit einem validen JSON-Objekt, ohne Markdown, ohne Erklaerungen.
Schema:
{
  "formulartyp": "Muster13",
  "kostentraeger_typ": "GKV",
  "krankenkasse": null,
  "heilmittel": [{"bezeichnung":"KG","behandlungseinheiten":6,"dauer_minuten":25,"ergaenzend":false,"konfidenz":"hoch"}],
  "frequenz_min_pro_woche": 2,
  "frequenz_max_pro_woche": 3,
  "flags": {"hausbesuch":false,"dringlich_14_tage":false,"therapiebericht":false},
  "diagnose": {"icd10":null,"text":null,"diagnosegruppe":null},
  "ausstellungsdatum": null,
  "gesamtkonfidenz": "hoch",
  "manuelle_pruefung_noetig": false
}`;

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: "E-Mail oder Passwort falsch" });
  const { data: profile } = await supabase.from("user_profiles").select("*").eq("id", data.user.id).single();
  res.json({ token: data.session.access_token, user: { id: data.user.id, email: data.user.email, ...profile } });
});

app.get("/auth/me", auth, async (req, res) => {
  const { data: profile } = await req.supabase.from("user_profiles").select("*").eq("id", req.user.id).single();
  res.json({ id: req.user.id, email: req.user.email, ...profile });
});

app.post("/auth/create-user", auth, adminOnly, async (req, res) => {
  const { email, password, name, rolle, mitarbeiter_id } = req.body;
  const adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await adminSupabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) return res.status(400).json({ error: error.message });
  await adminSupabase.from("user_profiles").insert({ id: data.user.id, name, rolle: rolle||"mitarbeiter", mitarbeiter_id: mitarbeiter_id||null });
  res.json({ success: true });
});

app.get("/auth/users", auth, adminOnly, async (req, res) => {
  const { data } = await req.supabase.from("user_profiles").select("*");
  res.json(data || []);
});

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
    res.status(500).json({ error: "Analyse fehlgeschlagen" });
  }
});

app.get("/mitarbeiter", auth, async (req, res) => {
  const { data, error } = await req.supabase.from("mitarbeiter").select("*").order("name");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/mitarbeiter", auth, adminOnly, async (req, res) => {
  const { data, error } = await req.supabase.from("mitarbeiter").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.put("/mitarbeiter/:id", auth, adminOnly, async (req, res) => {
  const { data, error } = await req.supabase.from("mitarbeiter").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete("/mitarbeiter/:id", auth, adminOnly, async (req, res) => {
  const { error } = await req.supabase.from("mitarbeiter").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get("/patienten", auth, async (req, res) => {
  const { data, error } = await req.supabase.from("patienten").select("*").order("nachname");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/patienten", auth, async (req, res) => {
  const { data, error } = await req.supabase.from("patienten").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.put("/patienten/:id", auth, async (req, res) => {
  const { data, error } = await req.supabase.from("patienten").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete("/patienten/:id", auth, adminOnly, async (req, res) => {
  const { error } = await req.supabase.from("patienten").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get("/termine", auth, async (req, res) => {
  const { data, error } = await req.supabase.from("termine").select("*").order("datum").order("start_zeit");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/termine", auth, async (req, res) => {
  const { data, error } = await req.supabase.from("termine").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.put("/termine/:id", auth, async (req, res) => {
  const { data, error } = await req.supabase.from("termine").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete("/termine/:id", auth, async (req, res) => {
  const { error } = await req.supabase.from("termine").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get("/urlaub", auth, async (req, res) => {
  const { data: profile } = await req.supabase.from("user_profiles").select("rolle,mitarbeiter_id").eq("id", req.user.id).single();
  let query = req.supabase.from("urlaub").select("*").order("von");
  if (profile?.rolle !== "admin") query = query.eq("mitarbeiter_id", profile?.mitarbeiter_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post("/urlaub", auth, async (req, res) => {
  const { data, error } = await req.supabase.from("urlaub").insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.put("/urlaub/:id", auth, async (req, res) => {
  const { data: profile } = await req.supabase.from("user_profiles").select("rolle").eq("id", req.user.id).single();
  if (req.body.status === "genehmigt" && profile?.rolle !== "admin") return res.status(403).json({ error: "Nur Admins koennen genehmigen" });
  const { data, error } = await req.supabase.from("urlaub").update(req.body).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete("/urlaub/:id", auth, async (req, res) => {
  const { error } = await req.supabase.from("urlaub").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Rezeptor API laeuft auf Port " + PORT));
