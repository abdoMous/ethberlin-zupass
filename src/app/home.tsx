'use client';

import { generateWitness } from '@/app/utils/pcd';

import { config } from '@/config/zuauth';
import { zuAuthPopup } from '@pcd/zuauth/client';
import { useCallback, useEffect, useReducer, useState } from 'react';

import {
    ENTRYPOINT_ADDRESS_V07,
    createSmartAccountClient,
} from 'permissionless';

import { signerToSafeSmartAccount } from 'permissionless/accounts';
import {
    createPimlicoBundlerClient,
    createPimlicoPaymasterClient,
} from 'permissionless/clients/pimlico';
import { Hex, createPublicClient, encodeFunctionData, http } from 'viem';
import { toBytes, toHex } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

type AuthState =
    | 'logged out'
    | 'auth-start'
    | 'authenticating'
    | 'authenticated'
    | 'error';

const abi = [
    {
        inputs: [],
        stateMutability: 'nonpayable',
        type: 'constructor',
    },
    {
        inputs: [
            {
                components: [
                    {
                        internalType: 'uint256[2]',
                        name: '_pA',
                        type: 'uint256[2]',
                    },
                    {
                        internalType: 'uint256[2][2]',
                        name: '_pB',
                        type: 'uint256[2][2]',
                    },
                    {
                        internalType: 'uint256[2]',
                        name: '_pC',
                        type: 'uint256[2]',
                    },
                    {
                        internalType: 'uint256[38]',
                        name: '_pubSignals',
                        type: 'uint256[38]',
                    },
                ],
                internalType: 'struct CommunityPortal.ProofArgs',
                name: 'proof',
                type: 'tuple',
            },
            {
                internalType: 'address',
                name: 'account',
                type: 'address',
            },
        ],
        name: 'addCommunityCollaborator',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [],
        name: 'communityPortal',
        outputs: [
            {
                internalType: 'contract FileversePortal',
                name: '',
                type: 'address',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'uint256[38]',
                name: '_pubSignals',
                type: 'uint256[38]',
            },
        ],
        name: 'getSignerFromPublicSignals',
        outputs: [
            {
                internalType: 'uint256[2]',
                name: '',
                type: 'uint256[2]',
            },
        ],
        stateMutability: 'pure',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'uint256[38]',
                name: '_pubSignals',
                type: 'uint256[38]',
            },
        ],
        name: 'getValidEventIdFromPublicSignals',
        outputs: [
            {
                internalType: 'uint256[]',
                name: '',
                type: 'uint256[]',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'uint256[38]',
                name: '_pubSignals',
                type: 'uint256[38]',
            },
        ],
        name: 'getWaterMarkFromPublicSignals',
        outputs: [
            {
                internalType: 'uint256',
                name: '',
                type: 'uint256',
            },
        ],
        stateMutability: 'pure',
        type: 'function',
    },
    {
        inputs: [],
        name: 'name',
        outputs: [
            {
                internalType: 'string',
                name: '',
                type: 'string',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'owner',
        outputs: [
            {
                internalType: 'address',
                name: '',
                type: 'address',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'trustedForwarder',
        outputs: [
            {
                internalType: 'address',
                name: '',
                type: 'address',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'uint256[2]',
                name: '_pA',
                type: 'uint256[2]',
            },
            {
                internalType: 'uint256[2][2]',
                name: '_pB',
                type: 'uint256[2][2]',
            },
            {
                internalType: 'uint256[2]',
                name: '_pC',
                type: 'uint256[2]',
            },
            {
                internalType: 'uint256[38]',
                name: '_pubSignals',
                type: 'uint256[38]',
            },
        ],
        name: 'verifyProof',
        outputs: [
            {
                internalType: 'bool',
                name: '',
                type: 'bool',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
];

export default function Home() {
    const [pcdStr, setPcdStr] = useState<string>('');
    const [authState, setAuthState] = useState<AuthState>('logged out');
    const [log, addLog] = useReducer((currentLog: string, toAdd: string) => {
        return `${currentLog}${currentLog === '' ? '' : '\n'}${toAdd}`;
    }, '');
    const [user, setUser] = useState<Record<string, string> | undefined>();

    const publicClient = createPublicClient({
        transport: http('https://rpc.ankr.com/eth_sepolia'),
    });

    const paymasterClient = createPimlicoPaymasterClient({
        transport: http(
            `https://api.pimlico.io/v2/sepolia/rpc?apikey=${PIMLICO_API_KEY}`
        ),
        entryPoint: ENTRYPOINT_ADDRESS_V07,
    });

    const pimlicoBundlerClient = createPimlicoBundlerClient({
        transport: http(
            `https://api.pimlico.io/v2/sepolia/rpc?apikey=${PIMLICO_API_KEY}`
        ),
        entryPoint: ENTRYPOINT_ADDRESS_V07,
    });

    const signer = privateKeyToAccount(PRIVATE_KEY);

    async function getAddCommunityCollaboratorCallData({ pcd, safeAccount }) {
        const callData = await safeAccount.encodeCallData({
            to: CONTRACT_ADDRESS,
            data: encodeFunctionData({
                abi: abi,
                functionName: 'addCommunityCollaborator',
                args: [pcd, safeAccount.address],
            }),
            value: BigInt(0),
        });
        return callData;
    }

    useEffect(() => {
        (async () => {
            if (authState === 'auth-start') {
                addLog('Fetching watermark');
                const watermark = (await (await fetch('/api/watermark')).json())
                    .watermark;
                addLog('Got watermark');
                addLog('Opening popup window');
                setAuthState('authenticating');
                const result = await zuAuthPopup({
                    zupassUrl: process.env
                        .NEXT_PUBLIC_ZUPASS_SERVER_URL as string,
                    fieldsToReveal: {
                        revealAttendeeEmail: true,
                        revealAttendeeName: true,
                    },
                    watermark,
                    config: config,
                });

                if (result.type === 'pcd') {
                    addLog('Received PCD');
                    setPcdStr(result.pcdStr);

                    const loginResult = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pcd: result.pcdStr }),
                    });

                    setUser((await loginResult.json()).user);
                    addLog('Authenticated successfully');
                    setAuthState('authenticated');
                } else if (result.type === 'popupBlocked') {
                    addLog('The popup was blocked by your browser');
                    setAuthState('error');
                } else if (result.type === 'popupClosed') {
                    addLog('The popup was closed before a result was received');
                    setAuthState('error');
                } else {
                    addLog(
                        `Unexpected result type from zuAuth: ${result.type}`
                    );
                    setAuthState('error');
                }
            }
        })();
    }, [addLog, authState]);

    const auth = useCallback(() => {
        if (authState === 'logged out' || authState === 'error') {
            addLog('Beginning authentication');
            setAuthState('auth-start');
        }
    }, [addLog, authState]);

    const createSafeAccount = useCallback(async () => {
        const safeAccount = await signerToSafeSmartAccount(publicClient, {
            entryPoint: ENTRYPOINT_ADDRESS_V07,
            signer: signer,
            saltNonce: 0n, // optional
            safeVersion: '1.4.1',
        });
        addLog(`Created safe account, address ${safeAccount.address}`);
    }, []);

    const addCommunityContributorUsingZuPass = useCallback(async () => {
        const safeAccount = await signerToSafeSmartAccount(publicClient, {
            entryPoint: ENTRYPOINT_ADDRESS_V07,
            signer: signer,
            saltNonce: 0n, // optional
            safeVersion: '1.4.1',
        });

        const smartAccountClient = createSmartAccountClient({
            account: safeAccount,
            entryPoint: ENTRYPOINT_ADDRESS_V07,
            chain: sepolia,
            bundlerTransport: http(
                `https://api.pimlico.io/v2/sepolia/rpc?apikey=${PIMLICO_API_KEY}`
            ),
            middleware: {
                sponsorUserOperation: paymasterClient.sponsorUserOperation, // optional
                gasPrice: async () =>
                    (await pimlicoBundlerClient.getUserOperationGasPrice())
                        .fast, // if using pimlico bundler
            },
        });

        const callData = await getAddCommunityCollaboratorCallData({
            safeAccount,
            pcd: generateWitness(JSON.parse(pcdStr)),
        });

        const gasPrices = await pimlicoBundlerClient.getUserOperationGasPrice();
        const userOperation =
            await smartAccountClient.prepareUserOperationRequest({
                userOperation: {
                    callData, // callData is the only required field in the partial user operation
                    nonce: toHex(toBytes(generatePrivateKey()).slice(0, 24), {
                        size: 32,
                    }) as any,
                    maxFeePerGas: gasPrices.fast.maxFeePerGas,
                    maxPriorityFeePerGas: gasPrices.fast.maxPriorityFeePerGas,
                },
                account: safeAccount,
            });
        userOperation.signature =
            await safeAccount.signUserOperation(userOperation);
        const txnHash = await smartAccountClient.sendUserOperation({
            userOperation,
        });
        addLog(
            `Adding Commmunity Collaborator ${safeAccount.address},pimlico txn hash: ${txnHash}`
        );
    }, []);

    const logout = useCallback(() => {
        setUser(undefined);
        setPcdStr('');
        setAuthState('logged out');
        addLog('Logged out');
    }, []);

    const stateClasses: Record<AuthState, string> = {
        'logged out': '',
        'auth-start': 'text-blue-300',
        authenticated: 'text-green-300',
        error: 'text-red-300',
        authenticating: 'text-blue-300',
    };

    return (
        <main
            className={`flex min-h-screen flex-col items-center justify-between p-24`}>
            <div className="z-10 max-w-5xl w-full text-sm">
                <button
                    onClick={authState === 'authenticated' ? logout : auth}
                    className="border rounded border-gray-400 px-4 py-2 font-medium text-md"
                    disabled={
                        authState === 'auth-start' ||
                        authState === 'authenticating'
                    }>
                    {authState === 'authenticated' ? `Log out` : `Authenticate`}
                </button>
                <button
                    onClick={createSafeAccount}
                    className="border rounded border-gray-400 px-4 py-2 font-medium text-md ml-4">
                    Create Safe Account
                </button>
                <div className="my-4">
                    Current authentication state is{' '}
                    <span
                        className={`font-semibold ${stateClasses[authState]}`}>
                        {authState}
                    </span>{' '}
                    {user && (
                        <>
                            as{' '}
                            <span className="font-medium text-yellow-200">{`${user.attendeeName} (${user.attendeeEmail})`}</span>
                        </>
                    )}
                </div>
                <h3 className="text-lg font-semibold my-2">Log</h3>
                <pre className="whitespace-pre-line border rounded-md border-gray-500 px-2 py-1">
                    {log}
                </pre>
                <h3 className="text-lg font-semibold mt-2">PCD</h3>
                <pre className="whitespace-pre-line border rounded-md border-gray-500 px-2 py-1">
                    {pcdStr}
                </pre>
            </div>
        </main>
    );
}
