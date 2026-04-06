"""
SnapSort Backend — DeepFace-powered face detection & verification API
Endpoints:
  POST /api/detect    — Detect faces in an image, return bounding boxes + crops
  POST /api/verify    — Compare two face crops, return same_person + distance
  POST /api/cluster   — Detect faces in multiple images, cluster by identity
  GET  /api/health    — Health check
"""

import sys
import os

# ─── Check if running inside virtual environment ───
if not (hasattr(sys, "real_prefix") or (hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix)):
    print("\n" + "=" * 60)
    print("  ERROR: Not running inside a virtual environment!")
    print("=" * 60)
    print("\n  Run these commands first:\n")
    print("    source venv/bin/activate")
    print("    python app.py")
    print("\n  Your prompt should show (venv) at the start.")
    print("=" * 60 + "\n")
    sys.exit(1)

import io
import base64
import uuid
import tempfile
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import numpy as np

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Temp dir for processing
TEMP_DIR = tempfile.mkdtemp(prefix="snapsort_")


def b64_to_image(b64_string):
    """Convert base64 string to PIL Image."""
    # Handle data URL format
    if "," in b64_string:
        b64_string = b64_string.split(",")[1]
    img_bytes = base64.b64decode(b64_string)
    return Image.open(io.BytesIO(img_bytes))


def image_to_b64(img, fmt="JPEG", quality=80):
    """Convert PIL Image to base64 string."""
    buf = io.BytesIO()
    if img.mode == "RGBA":
        img = img.convert("RGB")
    img.save(buf, format=fmt, quality=quality)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def save_temp_image(img):
    """Save PIL Image to temp file, return path."""
    path = os.path.join(TEMP_DIR, f"{uuid.uuid4().hex}.jpg")
    if img.mode == "RGBA":
        img = img.convert("RGB")
    img.save(path, "JPEG", quality=85)
    return path


def crop_face(img, facial_area, padding=0.25):
    """Crop face from image with padding."""
    x, y, w, h = facial_area["x"], facial_area["y"], facial_area["w"], facial_area["h"]
    pw, ph = int(w * padding), int(h * padding)
    left = max(0, x - pw)
    top = max(0, y - ph)
    right = min(img.width, x + w + pw)
    bottom = min(img.height, y + h + ph)
    return img.crop((left, top, right, bottom))


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "engine": "DeepFace"})


@app.route("/api/detect", methods=["POST"])
def detect_faces():
    """
    Detect all faces in an image using DeepFace (RetinaFace backend).
    
    Request JSON:
      { "image": "<base64 image>" }
    
    Response JSON:
      {
        "faces": [
          {
            "box": { "x": %, "y": %, "w": %, "h": % },
            "confidence": 0.99,
            "crop_b64": "<base64 face crop>",
            "thumb_b64": "<base64 96px thumbnail>"
          }
        ]
      }
    """
    try:
        from deepface import DeepFace

        data = request.get_json()
        if not data or "image" not in data:
            return jsonify({"error": "No image provided"}), 400

        img = b64_to_image(data["image"])
        img_path = save_temp_image(img)

        # Detect faces using RetinaFace (most accurate)
        try:
            detections = DeepFace.extract_faces(
                img_path=img_path,
                detector_backend="retinaface",
                enforce_detection=False,
                align=True,
            )
        except Exception:
            # Fallback to opencv if retinaface fails
            detections = DeepFace.extract_faces(
                img_path=img_path,
                detector_backend="opencv",
                enforce_detection=False,
                align=True,
            )

        faces = []
        for det in detections:
            # Skip low-confidence detections
            confidence = det.get("confidence", 0)
            if confidence < 0.5:
                continue

            fa = det.get("facial_area", {})
            if not fa or fa.get("w", 0) < 10 or fa.get("h", 0) < 10:
                continue

            # Convert to percentage coordinates
            box = {
                "x": round((fa["x"] / img.width) * 100, 2),
                "y": round((fa["y"] / img.height) * 100, 2),
                "w": round((fa["w"] / img.width) * 100, 2),
                "h": round((fa["h"] / img.height) * 100, 2),
            }

            # Extract face crop
            face_crop = crop_face(img, fa, padding=0.3)
            crop_resized = face_crop.resize((192, 192), Image.LANCZOS)
            crop_b64 = image_to_b64(crop_resized)

            # Thumbnail
            thumb = face_crop.resize((96, 96), Image.LANCZOS)
            thumb_b64 = image_to_b64(thumb, quality=70)

            faces.append({
                "box": box,
                "confidence": round(float(confidence), 4),
                "crop_b64": crop_b64,
                "thumb_b64": thumb_b64,
            })

        # Cleanup
        try:
            os.remove(img_path)
        except:
            pass

        return jsonify({"faces": faces, "count": len(faces)})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/verify", methods=["POST"])
def verify_faces():
    """
    Compare two face images using DeepFace.verify().
    
    Request JSON:
      { "face1": "<base64>", "face2": "<base64>" }
    
    Response JSON:
      {
        "same_person": true/false,
        "distance": 0.35,
        "threshold": 0.40,
        "model": "VGG-Face"
      }
    """
    try:
        from deepface import DeepFace

        data = request.get_json()
        if not data or "face1" not in data or "face2" not in data:
            return jsonify({"error": "Need face1 and face2"}), 400

        img1 = b64_to_image(data["face1"])
        img2 = b64_to_image(data["face2"])

        path1 = save_temp_image(img1)
        path2 = save_temp_image(img2)

        result = DeepFace.verify(
            img1_path=path1,
            img2_path=path2,
            model_name="VGG-Face",
            detector_backend="skip",  # Already cropped
            enforce_detection=False,
        )

        # Cleanup
        for p in [path1, path2]:
            try:
                os.remove(p)
            except:
                pass

        return jsonify({
            "same_person": bool(result.get("verified", False)),
            "distance": round(float(result.get("distance", 1.0)), 4),
            "threshold": round(float(result.get("threshold", 0.4)), 4),
            "model": "VGG-Face",
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/cluster", methods=["POST"])
def cluster_faces():
    """
    Full pipeline: detect faces in multiple images, then cluster by identity.
    
    Request JSON:
      {
        "images": [
          { "id": "photo_1", "data": "<base64>" },
          ...
        ],
        "existing_faces": [
          { "id": "face_0", "crop": "<base64>", "person_id": 0 },
          ...
        ]
      }
    
    Response JSON:
      {
        "photos": [
          {
            "id": "photo_1",
            "faces": [
              { "box": {...}, "confidence": 0.99, "person_id": 0, "thumb_b64": "..." }
            ]
          }
        ],
        "people": [
          { "id": 0, "face_count": 5, "thumb_b64": "..." }
        ]
      }
    """
    try:
        from deepface import DeepFace

        data = request.get_json()
        images = data.get("images", [])
        existing = data.get("existing_faces", [])

        if not images:
            return jsonify({"error": "No images"}), 400

        # Step 1: Detect faces in all images
        all_face_crops = []  # (crop_path, photo_id, face_idx, box, confidence, thumb_b64)

        # Add existing faces
        for ef in existing:
            eimg = b64_to_image(ef["crop"])
            epath = save_temp_image(eimg)
            all_face_crops.append({
                "path": epath,
                "photo_id": ef.get("photo_id", "existing"),
                "face_idx": ef.get("face_idx", 0),
                "box": ef.get("box", {}),
                "confidence": 1.0,
                "thumb_b64": ef.get("thumb_b64", ef["crop"]),
                "existing_person": ef.get("person_id", -1),
            })

        photo_results = []

        for img_data in images:
            img_id = img_data.get("id", str(uuid.uuid4()))
            img = b64_to_image(img_data["data"])
            img_path = save_temp_image(img)

            try:
                detections = DeepFace.extract_faces(
                    img_path=img_path,
                    detector_backend="retinaface",
                    enforce_detection=False,
                    align=True,
                )
            except:
                detections = DeepFace.extract_faces(
                    img_path=img_path,
                    detector_backend="opencv",
                    enforce_detection=False,
                    align=True,
                )

            faces_in_photo = []
            for fi, det in enumerate(detections):
                conf = det.get("confidence", 0)
                if conf < 0.5:
                    continue

                fa = det.get("facial_area", {})
                if not fa or fa.get("w", 0) < 10:
                    continue

                box = {
                    "x": round((fa["x"] / img.width) * 100, 2),
                    "y": round((fa["y"] / img.height) * 100, 2),
                    "w": round((fa["w"] / img.width) * 100, 2),
                    "h": round((fa["h"] / img.height) * 100, 2),
                }

                face_crop = crop_face(img, fa, padding=0.3)
                crop_path = save_temp_image(face_crop.resize((192, 192), Image.LANCZOS))
                thumb = image_to_b64(face_crop.resize((96, 96), Image.LANCZOS), quality=70)

                entry = {
                    "path": crop_path,
                    "photo_id": img_id,
                    "face_idx": fi,
                    "box": box,
                    "confidence": float(conf),
                    "thumb_b64": thumb,
                    "existing_person": -1,
                }
                all_face_crops.append(entry)
                faces_in_photo.append(entry)

            photo_results.append({
                "id": img_id,
                "faces": faces_in_photo,
            })

            try:
                os.remove(img_path)
            except:
                pass

        # Step 2: Cluster faces using pairwise DeepFace.verify
        n = len(all_face_crops)
        if n == 0:
            return jsonify({"photos": [], "people": []})

        # Build adjacency: which faces are the same person
        groups = list(range(n))  # Union-Find parent

        def find(x):
            while groups[x] != x:
                groups[x] = groups[groups[x]]
                x = groups[x]
            return x

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                groups[ra] = rb

        # Compare pairs (with limit)
        max_comparisons = min(n * (n - 1) // 2, 200)
        comparisons_done = 0

        for i in range(n):
            for j in range(i + 1, n):
                if comparisons_done >= max_comparisons:
                    break
                if find(i) == find(j):
                    continue  # Already in same group

                try:
                    result = DeepFace.verify(
                        img1_path=all_face_crops[i]["path"],
                        img2_path=all_face_crops[j]["path"],
                        model_name="VGG-Face",
                        detector_backend="skip",
                        enforce_detection=False,
                    )
                    comparisons_done += 1

                    if result.get("verified", False):
                        union(i, j)

                except Exception:
                    comparisons_done += 1
                    continue

            if comparisons_done >= max_comparisons:
                break

        # Build clusters
        cluster_map = {}
        for i in range(n):
            root = find(i)
            if root not in cluster_map:
                cluster_map[root] = []
            cluster_map[root].append(i)

        # Assign person IDs
        people = []
        person_id_map = {}  # face_index -> person_id

        for pid, (_, members) in enumerate(cluster_map.items()):
            # Check if any member has an existing person_id
            existing_pid = -1
            for mi in members:
                ep = all_face_crops[mi].get("existing_person", -1)
                if ep >= 0:
                    existing_pid = ep
                    break

            final_pid = existing_pid if existing_pid >= 0 else pid
            best_thumb = all_face_crops[members[0]]["thumb_b64"]

            for mi in members:
                person_id_map[mi] = final_pid

            people.append({
                "id": final_pid,
                "face_count": len(members),
                "thumb_b64": best_thumb,
            })

        # Build response
        for pr in photo_results:
            for face in pr["faces"]:
                # Find the index of this face in all_face_crops
                for idx, afc in enumerate(all_face_crops):
                    if afc["photo_id"] == face["photo_id"] and afc["face_idx"] == face["face_idx"]:
                        face["person_id"] = person_id_map.get(idx, -1)
                        break
                # Remove internal fields
                face.pop("path", None)
                face.pop("existing_person", None)

        # Cleanup temp files
        for afc in all_face_crops:
            try:
                os.remove(afc["path"])
            except:
                pass

        return jsonify({
            "photos": [{
                "id": pr["id"],
                "faces": [{
                    "box": f["box"],
                    "confidence": f["confidence"],
                    "person_id": f.get("person_id", -1),
                    "thumb_b64": f["thumb_b64"],
                } for f in pr["faces"]]
            } for pr in photo_results],
            "people": people,
            "comparisons": comparisons_done,
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print("=" * 50)
    print("SnapSort Backend — DeepFace API")
    print("=" * 50)
    print("Endpoints:")
    print("  POST /api/detect   — Detect faces in image")
    print("  POST /api/verify   — Compare two faces")
    print("  POST /api/cluster  — Full detection + clustering")
    print("  GET  /api/health   — Health check")
    print("=" * 50)

    # Pre-load DeepFace models on startup
    print("Loading DeepFace models (first run downloads ~500MB)...")
    try:
        from deepface import DeepFace
        # Warm up model
        DeepFace.build_model("VGG-Face")
        print("✓ VGG-Face model loaded")
    except Exception as e:
        print(f"⚠ Model pre-load: {e}")

    app.run(host="0.0.0.0", port=5001, debug=True)
