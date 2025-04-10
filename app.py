
from flask import Flask, request, jsonify
from transformers import AutoImageProcessor, AutoModelForImageClassification
from PIL import Image
import torch
import io
import joblib
from flask_cors import CORS
from web3 import Web3
import uuid
import os

app = Flask(__name__)
CORS(app)

# Load ML models
text_model = joblib.load("fine-tuned-deepfake-detector1.joblib")
text_vectorizer = joblib.load("fine-tuned-deepfake-detector1_processor.joblib")
image_model_name = "HrutikAdsare/deepfake-detector-faceforensics"
image_processor = AutoImageProcessor.from_pretrained(image_model_name)
image_model = AutoModelForImageClassification.from_pretrained(image_model_name)
image_labels = ["Real", "Deepfake"]

# Blockchain Configuration
w3 = Web3(Web3.HTTPProvider('https://sepolia.infura.io/v3/46196f83672a43b1ab82cebff69ac1b0'))

# Convert to checksum addresses
contract_address = Web3.to_checksum_address('0x1908fa6f230C9e3231D94a4168fAF68C8E6bb1Ce')
wallet_address = Web3.to_checksum_address('0xDC9141873EcFD67829B8BaaA8D0F425da4463CA0')

# Load private key securely (Use environment variables in production)

private_key = os.getenv("PRIVATE_KEY")
if not private_key:
    raise ValueError("Private key not set. Use environment variables.")

contract_abi = [
    {
        "inputs": [
            {"internalType": "string", "name": "mediaId", "type": "string"},
            {"internalType": "string", "name": "result", "type": "string"}
        ],
        "name": "logResult",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "string", "name": "mediaId", "type": "string"}
        ],
        "name": "getResult",
        "outputs": [
            {"internalType": "string", "name": "", "type": "string"},
            {"internalType": "uint256", "name": "", "type": "uint256"}
        ],
        "stateMutability": "view",
        "type": "function"
    }
]

contract = w3.eth.contract(address=contract_address, abi=contract_abi)

def log_to_blockchain(media_id, prediction):
    try:
        nonce = w3.eth.get_transaction_count(wallet_address, 'pending')  # Ensure correct nonce

        tx = contract.functions.logResult(media_id, prediction).build_transaction({
            'chainId': 11155111,  # Sepolia chain ID
            'gas': 300000,
            'gasPrice': w3.to_wei('30', 'gwei'),  # Increased gas price
            'nonce': nonce,
        })

        signed_txn = w3.eth.account.sign_transaction(tx, private_key)
        tx_hash = w3.eth.send_raw_transaction(signed_txn.raw_transaction)

        print(f"Transaction submitted: {tx_hash.hex()}")

        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)  # Increased timeout to 5 mins
        print(f"Transaction confirmed: {receipt.transactionHash.hex()}")

        return tx_hash.hex()

    except Exception as e:
        print(f"⚠️ Blockchain error: {str(e)}")
        return None


@app.route("/predict-text", methods=["POST"])
def predict_text():
    data = request.json
    if "text" not in data:
        return jsonify({"error": "Missing 'text' field"}), 400
    
    text = [data["text"]]
    features = text_vectorizer.transform(text)
    prediction = text_model.predict(features)[0]
    probabilities = text_model.predict_proba(features)[0].tolist()
    
    result = "fake" if prediction == 1 else "real"
    confidence = probabilities[1] if prediction == 1 else probabilities[0]
    
    media_id = f"text-{uuid.uuid4()}"
    tx_hash = log_to_blockchain(media_id, result)
    
    return jsonify({
        "prediction": result,
        "probability": {"fake": probabilities[1], "real": probabilities[0]},
        "mediaId": media_id,
        "txHash": tx_hash
    })

@app.route("/predict-image", methods=["POST"])
def predict_image():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files["file"]
    image = Image.open(io.BytesIO(file.read())).convert("RGB")

    inputs = image_processor(images=image, return_tensors="pt")
    with torch.no_grad():
        outputs = image_model(**inputs)
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
        predicted_class = torch.argmax(probs, dim=-1).item()

    prediction = image_labels[predicted_class].lower()  # Convert to lowercase
    confidence = float(probs[0][predicted_class])
    
    media_id = f"img-{uuid.uuid4()}"
    tx_hash = log_to_blockchain(media_id, prediction)
    
    return jsonify({
        "prediction": prediction,
        "confidence": confidence,
        "mediaId": media_id,
        "txHash": tx_hash
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
