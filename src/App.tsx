import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { joinPieces, splitText } from "./chunk";

type Lang = "en" | "uz";
type Status = "none" | "loading" | "ready" | "error";

const LANG_LABEL: Record<Lang, string> = { en: "English", uz: "O'zbekcha" };

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export default function App() {
  const [modelPath, setModelPath] = useState<string | null>(() => store.get("modelPath"));
  const [useGpu, setUseGpu] = useState(() => store.get("useGpu") !== "0");
  const [status, setStatus] = useState<Status>("none");
  const [error, setError] = useState("");

  const [src, setSrc] = useState<Lang>("en");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelRef = useRef(false);

  const tgt: Lang = src === "en" ? "uz" : "en";

  const loadModel = useCallback(async (path: string, gpu: boolean) => {
    setStatus("loading");
    setError("");
    try {
      await invoke("start_engine", { modelPath: path, useGpu: gpu });
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(String(e));
    }
  }, []);

  // Load the last used model on start.
  useEffect(() => {
    if (modelPath) loadModel(modelPath, useGpu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickModel() {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "GGUF model", extensions: ["gguf"] }],
    });
    if (typeof picked !== "string") return;
    setModelPath(picked);
    store.set("modelPath", picked);
    loadModel(picked, useGpu);
  }

  function toggleGpu() {
    const next = !useGpu;
    setUseGpu(next);
    store.set("useGpu", next ? "1" : "0");
    if (modelPath) loadModel(modelPath, next);
  }

  async function translate() {
    if (status !== "ready" || busy || !input.trim()) return;
    const pieces = splitText(input);
    const todo = pieces.map((p, i) => (p.translate ? i : -1)).filter((i) => i >= 0);
    const out: string[] = [];
    setBusy(true);
    setOutput("");
    setError("");
    cancelRef.current = false;
    try {
      for (let n = 0; n < todo.length; n++) {
        if (cancelRef.current) break;
        setProgress([n + 1, todo.length]);
        const i = todo[n];
        out[i] = await invoke<string>("translate", { text: pieces[i].text, src, tgt });
        setOutput(joinPieces(pieces, out));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function swap() {
    setSrc(tgt);
    if (output) {
      setInput(output);
      setOutput(input);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      translate();
    }
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">MA</span>
          <span className="title">Tarjimon</span>
        </div>
        <div className="model">
          <span className={`dot ${status}`} />
          <span className="model-text">
            {status === "none" && "Model tanlanmagan"}
            {status === "loading" && `Yuklanmoqda… ${modelPath ? fileName(modelPath) : ""}`}
            {status === "ready" && modelPath && fileName(modelPath)}
            {status === "error" && "Model yuklanmadi"}
          </span>
          <label className="gpu" title="Video karta (GPU) bo'lsa tezroq ishlaydi">
            <input type="checkbox" checked={useGpu} onChange={toggleGpu} disabled={status === "loading"} />
            GPU
          </label>
          <button className="ghost" onClick={pickModel} disabled={status === "loading"}>
            {modelPath ? "Modelni almashtirish" : "Model tanlash (.gguf)"}
          </button>
        </div>
      </header>

      {status === "none" && (
        <div className="notice">
          Boshlash uchun <b>Model tanlash</b> tugmasini bosing va kompyuteringizdagi <code>.gguf</code> model faylini
          tanlang. Tarjima butunlay kompyuteringizda bajariladi, internet kerak emas.
        </div>
      )}
      {error && <pre className="error">{error}</pre>}

      <main className="panes">
        <section className="pane">
          <div className="pane-head">{LANG_LABEL[src]}</div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={src === "en" ? "Enter text to translate…" : "Tarjima qilinadigan matnni kiriting…"}
            spellCheck={false}
            autoFocus
          />
          <div className="pane-foot">
            <span className="muted">{input.length} belgi</span>
            {input && (
              <button className="link" onClick={() => { setInput(""); setOutput(""); }}>
                Tozalash
              </button>
            )}
          </div>
        </section>

        <button className="swap" onClick={swap} title="Tillarni almashtirish" disabled={busy}>
          ⇄
        </button>

        <section className="pane">
          <div className="pane-head">{LANG_LABEL[tgt]}</div>
          <textarea value={output} readOnly placeholder="Tarjima shu yerda chiqadi" />
          <div className="pane-foot">
            <span className="muted">{progress ? `${progress[0]} / ${progress[1]} qism` : ""}</span>
            {output && (
              <button className="link" onClick={copy}>
                {copied ? "Nusxalandi ✓" : "Nusxalash"}
              </button>
            )}
          </div>
        </section>
      </main>

      <footer className="bottom">
        <span className="muted hint">Ctrl + Enter — tarjima qilish</span>
        {busy ? (
          <button className="primary" onClick={() => (cancelRef.current = true)}>
            To'xtatish
          </button>
        ) : (
          <button className="primary" onClick={translate} disabled={status !== "ready" || !input.trim()}>
            Tarjima qilish
          </button>
        )}
      </footer>
    </div>
  );
}
