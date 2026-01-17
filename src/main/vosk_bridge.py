import sys
import json
import os
from vosk import Model, KaldiRecognizer

# Set log level to -1 to disable logs
import vosk
vosk.SetLogLevel(-1)

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Model path required"}))
        return

    model_path = sys.argv[1]
    if not os.path.exists(model_path):
        print(json.dumps({"error": f"Model path not found: {model_path}"}))
        return

    try:
        model = Model(model_path)
        # Vosk expects 16k mono PCM
        rec = KaldiRecognizer(model, 16000)
        
        print(json.dumps({"status": "ready"}))
        sys.stdout.flush()

        while True:
            data = sys.stdin.buffer.read(4000)
            if len(data) == 0:
                break
            
            if rec.AcceptWaveform(data):
                result = json.loads(rec.Result())
                if result.get("text"):
                    print(json.dumps({"text": result["text"], "final": True}))
                    sys.stdout.flush()
            else:
                partial = json.loads(rec.PartialResult())
                if partial.get("partial"):
                    print(json.dumps({"text": partial["partial"], "final": False}))
                    sys.stdout.flush()

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.stdout.flush()

if __name__ == "__main__":
    main()
