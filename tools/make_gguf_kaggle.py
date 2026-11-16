# Make the GGUF model file for MA Tarjimon — run on Kaggle (CPU is enough, Internet ON,
# Secret: HF_TOKEN with Write access). Takes ~20-30 min.
#
# 1. Merges the LoRA adapter (default: v2) into google/translategemma-4b-it in bf16.
# 2. Converts the merged model to GGUF with llama.cpp (Q8_0, recommended for translation quality).
# 3. Uploads the .gguf to a separate private HF repo: <user>/translategemma-4b-uzbek-gguf
#
# Paste into ONE Kaggle cell. Run the pip line first in its own cell if you prefer.

# !pip install -q -U peft==0.21.2 transformers==5.22.1 gguf sentencepiece

import os, subprocess, sys
import torch
from huggingface_hub import HfApi, login
from kaggle_secrets import UserSecretsClient
from peft import PeftModel
from transformers import AutoModelForImageTextToText, AutoProcessor

login(UserSecretsClient().get_secret("HF_TOKEN"))

BASE_ID = "google/translategemma-4b-it"
ADAPTER = "Muhammadaziz3101/translategemma-4b-uzbek-adapter"
VERSION = "v2"
MERGED = "/kaggle/working/merged"
OUT = f"/kaggle/working/translategemma-4b-uzbek-{VERSION}-Q8_0.gguf"
GGUF_REPO = "Muhammadaziz3101/translategemma-4b-uzbek-gguf"

# --- 1. merge (full precision, not 4-bit, so the merged weights are clean) ---
model = AutoModelForImageTextToText.from_pretrained(BASE_ID, dtype=torch.bfloat16, device_map="cpu")
model = PeftModel.from_pretrained(model, ADAPTER, revision=VERSION)
model = model.merge_and_unload()
model.save_pretrained(MERGED, safe_serialization=True)
AutoProcessor.from_pretrained(BASE_ID).save_pretrained(MERGED)
del model
print("Merged ->", MERGED, os.listdir(MERGED))

# --- 2. convert to GGUF ---
if not os.path.exists("/kaggle/working/llama.cpp"):
    subprocess.run(["git", "clone", "--depth", "1", "https://github.com/ggml-org/llama.cpp", "/kaggle/working/llama.cpp"], check=True)
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", "/kaggle/working/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt"], check=False)
subprocess.run([sys.executable, "/kaggle/working/llama.cpp/convert_hf_to_gguf.py", MERGED,
                "--outtype", "q8_0", "--outfile", OUT], check=True)
print("GGUF ->", OUT, round(os.path.getsize(OUT) / 1e9, 2), "GB")

# --- 3. upload ---
api = HfApi()
api.create_repo(GGUF_REPO, private=True, exist_ok=True)
api.upload_file(path_or_fileobj=OUT, path_in_repo=os.path.basename(OUT), repo_id=GGUF_REPO,
                commit_message=f"{VERSION} merged, Q8_0")
print(f"Done: https://huggingface.co/{GGUF_REPO}")
