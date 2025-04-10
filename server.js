
// Add this near the top with your other constants
const GAS_LIMIT = 500000; // Increased gas limit
const GAS_PRICE_MULTIPLIER = 1.5; // 50% higher than estimated

const express = require('express');
const fileUpload = require('express-fileupload');
const { ethers } = require('ethers');
const cors = require('cors');
const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(fileUpload());
app.use(express.json());

// Blockchain Configuration
const provider = new ethers.JsonRpcProvider('https://sepolia.infura.io/v3/46196f83672a43b1ab82cebff69ac1b0');
const privateKey = process.env.PRIVATE_KEY || '56d1da213833ff9d85cb83f97f2f3a16e1d91d1ab397c18121968a0abb989a61';
const wallet = new ethers.Wallet(privateKey, provider);
const contractAddress = '0x1908fa6f230C9e3231D94a4168fAF68C8E6bb1Ce';

// Contract ABI - Updated to match your Solidity contract
const contractABI = [
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
];

const contract = new ethers.Contract(contractAddress, contractABI, wallet);

// Transaction configuration
const TX_CONFIG = {
    MAX_RETRIES: 3,
    GAS_LIMIT: 1000000, // 1 million gas
    GAS_BUFFER: 1.3, // 30% buffer
    TIMEOUT: 60000 // 60 seconds
};

// Enhanced transaction handler with revert reason capture
async function sendTransactionWithRetry(contractFunction, args) {
    let lastError;
    
    for (let attempt = 1; attempt <= TX_CONFIG.MAX_RETRIES; attempt++) {
        try {
            // Get current gas fees
            const feeData = await provider.getFeeData();
            
            // Estimate gas with error handling
            let estimatedGas;
            try {
                estimatedGas = await contractFunction.estimateGas(...args);
                console.log(`Gas estimate: ${estimatedGas.toString()}`);
            } catch (estimateError) {
                console.error('Gas estimation failed:', {
                    message: estimateError.message,
                    data: estimateError.data
                });
                throw new Error(`Transaction pre-check failed: ${estimateError.reason || estimateError.message}`);
            }

            // Calculate gas parameters
            const gasLimit = Math.min(
                Math.ceil(estimatedGas * TX_CONFIG.GAS_BUFFER),
                TX_CONFIG.GAS_LIMIT
            );

            // Send transaction
            const tx = await contractFunction(...args, {
                gasLimit,
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
            });

            const txHash = tx.hash.startsWith("0x") ? tx.hash : "0x${tx.hash}";
            //console.log(`Transaction sent (Attempt ${attempt}): ${txHash}`);


            // Wait for transaction receipt with timeout
            const receipt = await Promise.race([
                tx.wait(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Transaction timeout')), TX_CONFIG.TIMEOUT)
                )
            ]);

            if (receipt.status === 0) {
                throw new Error('Transaction reverted without reason');
            }

            return {
                txHash: tx.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString()
            };

        } catch (error) {
            lastError = error;
            console.error(`Attempt ${attempt} failed:`, {
                error: error.message,
                code: error.code,
                reason: error.reason,
                stack: error.stack
            });

            if (attempt >= TX_CONFIG.MAX_RETRIES || 
                error.code === 'CALL_EXCEPTION' || 
                error.code === 'INVALID_ARGUMENT') {
                break;
            }

            // Exponential backoff before retry
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
    }

    throw lastError;
}

// Mock ML Prediction Functions
async function predictImage(file) {
    return {
        prediction: Math.random() > 0.5 ? 'fake' : 'real', // lowercase to match contract
        confidence: Math.random()
    };
}

async function predictText(text) {
    return {
        prediction: Math.random() > 0.5 ? 'fake' : 'real', // lowercase to match contract
        probability: {
            fake: Math.random(),
            real: 1 - Math.random()
        }
    };
}

// Parameter validation
function validateParameters(mediaId, prediction) {
    const errors = [];
    
    if (typeof mediaId !== 'string' || mediaId.length === 0) {
        errors.push('Invalid mediaId');
    }
    
    if (prediction !== 'real' && prediction !== 'fake') {
        errors.push('Prediction must be "real" or "fake" (lowercase)');
    }
    
    return errors;
}

// Routes
app.post('/predict-image', async (req, res) => {
    try {
        if (!req.files?.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const file = req.files.file;
        const mediaId = `image-${Date.now()}-${file.name.replace(/\s+/g, '-')}`;
        const prediction = await predictImage(file);
        
        // Validate before sending to blockchain
        const validationErrors = validateParameters(mediaId, prediction.prediction);
        if (validationErrors.length > 0) {
            return res.status(400).json({ errors: validationErrors });
        }

        try {
            const txReceipt = await sendTransactionWithRetry(
                contract.logResult,
                [mediaId, prediction.prediction]
            );
            
            res.json({
                success: true,
                mediaId,
                prediction: prediction.prediction,
                confidence: prediction.confidence,
                transactionHash: txReceipt.txHash.startsWith("0x") ? txReceipt.txHash : `0x${txReceipt.txHash}`
            });
            
        } catch (blockchainError) {
            res.status(502).json({
                error: "Blockchain transaction failed",
                details: blockchainError.message,
                prediction: prediction.prediction
            });
        }
    } catch (error) {
        console.error("Image prediction error:", error);
        res.status(500).json({ 
            error: 'Error processing image',
            details: error.message 
        });
    }
});

app.post('/predict-text', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'No text provided' });
        }

        const mediaId = `text-${Date.now()}`;
        const prediction = await predictText(text);
        
        // Validate before sending to blockchain
        const validationErrors = validateParameters(mediaId, prediction.prediction);
        if (validationErrors.length > 0) {
            return res.status(400).json({ errors: validationErrors });
        }

        try {
            const txReceipt = await sendTransactionWithRetry(
                contract.logResult,
                [mediaId, prediction.prediction]
            );
            
            res.json({
                success: true,
                mediaId,
                prediction: prediction.prediction,
                probability: prediction.probability,
                transactionHash: txReceipt.txHash.startsWith("0x") ? txReceipt.txHash : `0x${txReceipt.txHash}`
            });
            
        } catch (blockchainError) {
            res.status(502).json({
                error: "Blockchain transaction failed",
                details: blockchainError.message,
                prediction: prediction.prediction
            });
        }
    } catch (error) {
        console.error("Text prediction error:", error);
        res.status(500).json({ 
            error: 'Error processing text',
            details: error.message 
        });
    }
});

// Verification endpoint
app.get('/verify/:mediaId', async (req, res) => {
    try {
        const { mediaId } = req.params;
        const [result, timestamp] = await contract.getResult(mediaId);
        
        res.json({
            mediaId,
            result,
            timestamp: Number(timestamp),
            exists: timestamp > 0
        });
    } catch (error) {
        console.error("Verification error:", error);
        
        if (error.code === 'CALL_EXCEPTION') {
            return res.status(404).json({ error: 'Media ID not found' });
        }
        
        res.status(500).json({ 
            error: 'Error verifying result',
            details: error.message 
        });
    }
});

// Start server
// Start server
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    
    try {
        // Get network information
        const network = await provider.getNetwork();
        const blockNumber = await provider.getBlockNumber();
        const feeData = await provider.getFeeData();
        
        console.log(`Blockchain connected to: ${network.name} (Chain ID: ${network.chainId})`);
        console.log(`Current block number: ${blockNumber}`);
        console.log(`Contract address: ${contractAddress}`);
        console.log(`Wallet address: ${wallet.address}`);
        console.log('Current gas fees:');
        console.log(`- Max Fee Per Gas: ${ethers.formatUnits(feeData.maxFeePerGas || 0, 'gwei')} gwei`);
        console.log(`- Max Priority Fee Per Gas: ${ethers.formatUnits(feeData.maxPriorityFeePerGas || 0, 'gwei')} gwei`);
        console.log(`Configured Gas Limit: ${GAS_LIMIT}`);
        console.log(`Gas Price Multiplier: ${GAS_PRICE_MULTIPLIER}x`);
    } catch (error) {
        console.error('Error connecting to blockchain:', error);
        process.exit(1); // Exit if we can't connect to blockchain
    }
});