import { JsonRpcProvider, Wallet, Contract } from "ethers";

// ✅ Use a stable Sepolia RPC from Alchemy, Infura, or QuickNode
const provider = new JsonRpcProvider("https://sepolia.infura.io/v3/46196f83672a43b1ab82cebff69ac1b0");

const wallet = new Wallet("56d1da213833ff9d85cb83f97f2f3a16e1d91d1ab397c18121968a0abb989a61", provider);
const contractAddress = "0x1908fa6f230C9e3231D94a4168fAF68C8E6bb1Ce";
const abi = [
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
            { "internalType": "string", "name": "mediaId", "type": "string" }
        ],
        "name": "getResult",
        "outputs": [
            { "internalType": "string", "name": "", "type": "string" },
            { "internalType": "uint256", "name": "", "type": "uint256" }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

const contract = new Contract(contractAddress, abi, wallet);

async function logResult(mediaId, result) {
    const tx = await contract.logResult(mediaId, result);
    await tx.wait();
    console.log("Result logged on blockchain:", tx.hash);
}

async function getResult(mediaId) {
    const [result, timestamp] = await contract.getResult(mediaId);
    console.log("Detection Result:", result);
    console.log("Timestamp:", new Date(Number(timestamp) * 1000).toLocaleString());
    return result;
}

// Example usage
(async () => {
    await logResult("media123", "fake");
    await getResult("media123");
})();
