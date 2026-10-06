var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// src/common/spl-token.ts
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from "@solana/web3.js";
function getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve = false, tokenProgram = TOKEN_PROGRAM_ID, associatedTokenProgram = ASSOCIATED_TOKEN_PROGRAM_ID) {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) {
    throw new Error("Token owner is off curve");
  }
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    associatedTokenProgram
  )[0];
}
function createAssociatedTokenAccountIdempotentInstruction(payer, associatedToken, owner, mint, tokenProgram = TOKEN_PROGRAM_ID, associatedTokenProgram = ASSOCIATED_TOKEN_PROGRAM_ID) {
  return TokenUtil.createAssociatedTokenAccountIdempotentInstruction(
    payer,
    associatedToken,
    owner,
    mint,
    tokenProgram,
    associatedTokenProgram
  );
}
function createCloseAccountInstruction(account, destination, authority, multiSigners = [], tokenProgram = TOKEN_PROGRAM_ID) {
  return TokenInstructionBuilder.closeAccount(
    account,
    destination,
    authority,
    multiSigners.map((signer) => signer instanceof PublicKey ? signer : signer.publicKey),
    tokenProgram
  );
}
function createSyncNativeInstruction(account, tokenProgram = TOKEN_PROGRAM_ID) {
  return TokenInstructionBuilder.syncNative(account, tokenProgram);
}
var TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, TokenInstructionBuilder, TokenUtil, WSOL_MINT, NATIVE_MINT, USDC_MINT, USDT_MINT;
var init_spl_token = __esm({
  "src/common/spl-token.ts"() {
    "use strict";
    TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    TokenInstructionBuilder = class {
      /**
       * Create InitializeMint instruction
       */
      static initializeMint(mint, decimals, mintAuthority, freezeAuthority, tokenProgram = TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
        ];
        const data = Buffer.alloc(67);
        data.writeUInt8(0 /* InitializeMint */, 0);
        data.writeUInt8(decimals, 1);
        data.writeUInt8(1, 2);
        data.set(mintAuthority.toBytes(), 3);
        data.writeUInt8(freezeAuthority ? 1 : 0, 35);
        if (freezeAuthority) {
          data.set(freezeAuthority.toBytes(), 36);
        }
        return new TransactionInstruction({
          keys,
          programId: tokenProgram,
          data
        });
      }
      /**
       * Create InitializeAccount instruction
       */
      static initializeAccount(account, mint, owner, tokenProgram = TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: account, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: owner, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
        ];
        const data = Buffer.from([1 /* InitializeAccount */]);
        return new TransactionInstruction({
          keys,
          programId: tokenProgram,
          data
        });
      }
      /**
       * Create Transfer instruction
       */
      static transfer(source, destination, owner, amount, multiSigners = [], tokenProgram = TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: source, isSigner: false, isWritable: true },
          { pubkey: destination, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: multiSigners.length === 0, isWritable: false },
          ...multiSigners.map((signer) => ({
            pubkey: signer,
            isSigner: true,
            isWritable: false
          }))
        ];
        const data = Buffer.alloc(9);
        data.writeUInt8(3 /* Transfer */, 0);
        data.writeBigUInt64LE(amount, 1);
        return new TransactionInstruction({
          keys,
          programId: tokenProgram,
          data
        });
      }
      /**
       * Create TransferChecked instruction
       */
      static transferChecked(source, mint, destination, owner, amount, decimals, multiSigners = [], tokenProgram = TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: source, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: destination, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: multiSigners.length === 0, isWritable: false },
          ...multiSigners.map((signer) => ({
            pubkey: signer,
            isSigner: true,
            isWritable: false
          }))
        ];
        const data = Buffer.alloc(10);
        data.writeUInt8(12 /* TransferChecked */, 0);
        data.writeBigUInt64LE(amount, 1);
        data.writeUInt8(decimals, 9);
        return new TransactionInstruction({
          keys,
          programId: tokenProgram,
          data
        });
      }
      /**
       * Create MintTo instruction
       */
      static mintTo(mint, destination, authority, amount, multiSigners = [], tokenProgram = TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: destination, isSigner: false, isWritable: true },
          { pubkey: authority, isSigner: multiSigners.length === 0, isWritable: false },
          ...multiSigners.map((signer) => ({
            pubkey: signer,
            isSigner: true,
            isWritable: false
          }))
        ];
        const data = Buffer.alloc(9);
        data.writeUInt8(7 /* MintTo */, 0);
        data.writeBigUInt64LE(amount, 1);
        return new TransactionInstruction({
          keys,
          programId: tokenProgram,
          data
        });
      }
      /**
       * Create Burn instruction
       */
      static burn(account, mint, owner, amount, multiSigners = [], tokenProgram = TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: account, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: multiSigners.length === 0, isWritable: false },
          ...multiSigners.map((signer) => ({
            pubkey: signer,
            isSigner: true,
            isWritable: false
          }))
        ];
        const data = Buffer.alloc(9);
        data.writeUInt8(8 /* Burn */, 0);
        data.writeBigUInt64LE(amount, 1);
        return new TransactionInstruction({
          keys,
          programId: tokenProgram,
          data
        });
      }
      /**
       * Create Approve instruction
       */
      static approve(account, delegate, owner, amount, multiSigners = [], tokenProgram = TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: account, isSigner: false, isWritable: true },
          { pubkey: delegate, isSigner: false, isWritable: false },
          { pubkey: owner, isSigner: multiSigners.length === 0, isWritable: false },
          ...multiSigners.map((signer) => ({
            pubkey: signer,
            isSigner: true,
            isWritable: false
          }))
        ];
        const data = Buffer.alloc(9);
        data.writeUInt8(4 /* Approve */, 0);
        data.writeBigUInt64LE(amount, 1);
        return new TransactionInstruction({
          keys,
          programId: tokenProgram,
          data
        });
      }
      /**
       * Create Revoke instruction
       */
      static revoke(account, owner, multiSigners = [], tokenProgram = TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: account, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: multiSigners.length === 0, isWritable: false },
          ...multiSigners.map((signer) => ({
            pubkey: signer,
            isSigner: true,
            isWritable: false
          }))
        ];
        const data = Buffer.from([5 /* Revoke */]);
        return new TransactionInstruction({
          keys,
          programId: tokenProgram,
          data
        });
      }
      /**
       * Create CloseAccount instruction
       */
      static closeAccount(account, destination, owner, multiSigners = [], tokenProgram = TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: account, isSigner: false, isWritable: true },
          { pubkey: destination, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: multiSigners.length === 0, isWritable: false },
          ...multiSigners.map((signer) => ({
            pubkey: signer,
            isSigner: true,
            isWritable: false
          }))
        ];
        const data = Buffer.from([9 /* CloseAccount */]);
        return new TransactionInstruction({
          keys,
          programId: tokenProgram,
          data
        });
      }
      /**
       * Create SyncNative instruction (for WSOL accounts)
       */
      static syncNative(nativeAccount, tokenProgram = TOKEN_PROGRAM_ID) {
        const keys = [{ pubkey: nativeAccount, isSigner: false, isWritable: true }];
        const data = Buffer.from([17 /* SyncNative */]);
        return new TransactionInstruction({
          keys,
          programId: tokenProgram,
          data
        });
      }
    };
    TokenUtil = class {
      /**
       * Calculate associated token account address
       */
      static async getAssociatedTokenAddress(mint, owner, allowOwnerOffCurve = false, tokenProgram = TOKEN_PROGRAM_ID, associatedTokenProgram = ASSOCIATED_TOKEN_PROGRAM_ID) {
        if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) {
          throw new Error("Token owner is off curve");
        }
        const [address] = await PublicKey.findProgramAddress(
          [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
          associatedTokenProgram
        );
        return address;
      }
      /**
       * Create associated token account idempotent instruction
       */
      static createAssociatedTokenAccountIdempotentInstruction(payer, associatedToken, owner, mint, tokenProgram = TOKEN_PROGRAM_ID, associatedTokenProgram = ASSOCIATED_TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: payer, isSigner: true, isWritable: true },
          { pubkey: associatedToken, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: tokenProgram, isSigner: false, isWritable: false }
        ];
        const data = Buffer.from([1]);
        return new TransactionInstruction({
          keys,
          programId: associatedTokenProgram,
          data
        });
      }
      /**
       * Create associated token account instruction
       */
      static createAssociatedTokenAccountInstruction(payer, associatedToken, owner, mint, tokenProgram = TOKEN_PROGRAM_ID, associatedTokenProgram = ASSOCIATED_TOKEN_PROGRAM_ID) {
        const keys = [
          { pubkey: payer, isSigner: true, isWritable: true },
          { pubkey: associatedToken, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: tokenProgram, isSigner: false, isWritable: false }
        ];
        const data = Buffer.alloc(0);
        return new TransactionInstruction({
          keys,
          programId: associatedTokenProgram,
          data
        });
      }
      /**
       * Check if a token is a wrapped SOL (WSOL) token
       */
      static isWrappedSol(mint) {
        return mint.equals(WSOL_MINT);
      }
      /**
       * Convert token amount to UI amount (with decimals)
       */
      static toUiAmount(amount, decimals) {
        return Number(amount) / Math.pow(10, decimals);
      }
      /**
       * Convert UI amount to token amount (with decimals)
       */
      static fromUiAmount(uiAmount, decimals) {
        return BigInt(Math.floor(uiAmount * Math.pow(10, decimals)));
      }
      /**
       * Format token amount for display
       */
      static formatAmount(amount, decimals, maxDecimals = 6) {
        const uiAmount = this.toUiAmount(amount, decimals);
        return uiAmount.toLocaleString("en-US", {
          maximumFractionDigits: maxDecimals
        });
      }
    };
    WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
    NATIVE_MINT = WSOL_MINT;
    USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
  }
});

// src/instruction/meteora_damm_v2_builder.ts
import {
  PublicKey as PublicKey2,
  Keypair,
  TransactionInstruction as TransactionInstruction2,
  SystemProgram as SystemProgram2
} from "@solana/web3.js";
function decodeMeteoraPool(data) {
  if (data.length < METEORA_POOL_SIZE) return null;
  let offset = 0;
  const take = (size) => {
    const value = Buffer.from(data.subarray(offset, offset + size));
    offset += size;
    return value;
  };
  const integer2 = (size) => {
    const value = take(size);
    let n = 0n;
    for (let i = size - 1; i >= 0; i--) n = n << 8n | BigInt(value[i]);
    return n;
  };
  const readBaseFeeStruct = () => ({
    cliffFeeNumerator: integer2(8),
    feeSchedulerMode: Number(integer2(1)),
    padding0: take(5),
    numberOfPeriod: Number(integer2(2)),
    periodFrequency: integer2(8),
    reductionFactor: integer2(8),
    padding1: integer2(8)
  });
  const readDynamicFeeStruct = () => ({
    initialized: Number(integer2(1)),
    padding: take(7),
    maxVolatilityAccumulator: Number(integer2(4)),
    variableFeeControl: Number(integer2(4)),
    binStep: Number(integer2(2)),
    filterPeriod: Number(integer2(2)),
    decayPeriod: Number(integer2(2)),
    reductionFactor: Number(integer2(2)),
    lastUpdateTimestamp: integer2(8),
    binStepU128: integer2(16),
    sqrtPriceReference: integer2(16),
    volatilityAccumulator: integer2(16),
    volatilityReference: integer2(16)
  });
  const readPoolFeesStruct = () => ({
    baseFee: readBaseFeeStruct(),
    protocolFeePercent: Number(integer2(1)),
    partnerFeePercent: Number(integer2(1)),
    referralFeePercent: Number(integer2(1)),
    padding0: take(5),
    dynamicFee: readDynamicFeeStruct(),
    padding1: Array.from({ length: 2 }, () => integer2(8))
  });
  const readPoolMetrics = () => ({
    totalLpAFee: integer2(16),
    totalLpBFee: integer2(16),
    totalProtocolAFee: integer2(8),
    totalProtocolBFee: integer2(8),
    totalPartnerAFee: integer2(8),
    totalPartnerBFee: integer2(8),
    totalPosition: integer2(8),
    padding: integer2(8)
  });
  const readRewardInfo = () => ({
    initialized: Number(integer2(1)),
    rewardTokenFlag: Number(integer2(1)),
    padding0: take(6),
    padding1: take(8),
    mint: new PublicKey2(take(32)),
    vault: new PublicKey2(take(32)),
    funder: new PublicKey2(take(32)),
    rewardDuration: integer2(8),
    rewardDurationEnd: integer2(8),
    rewardRate: integer2(16),
    rewardPerTokenStored: take(32),
    lastUpdateTime: integer2(8),
    cumulativeSecondsWithEmptyLiquidityReward: integer2(8)
  });
  const readPool = () => ({
    poolFees: readPoolFeesStruct(),
    tokenAMint: new PublicKey2(take(32)),
    tokenBMint: new PublicKey2(take(32)),
    tokenAVault: new PublicKey2(take(32)),
    tokenBVault: new PublicKey2(take(32)),
    whitelistedVault: new PublicKey2(take(32)),
    partner: new PublicKey2(take(32)),
    liquidity: integer2(16),
    padding: integer2(16),
    protocolAFee: integer2(8),
    protocolBFee: integer2(8),
    partnerAFee: integer2(8),
    partnerBFee: integer2(8),
    sqrtMinPrice: integer2(16),
    sqrtMaxPrice: integer2(16),
    sqrtPrice: integer2(16),
    activationPoint: integer2(8),
    activationType: Number(integer2(1)),
    poolStatus: Number(integer2(1)),
    tokenAFlag: Number(integer2(1)),
    tokenBFlag: Number(integer2(1)),
    collectFeeMode: Number(integer2(1)),
    poolType: Number(integer2(1)),
    padding0: take(2),
    feeAPerLiquidity: take(32),
    feeBPerLiquidity: take(32),
    permanentLockLiquidity: integer2(16),
    metrics: readPoolMetrics(),
    padding1: Array.from({ length: 10 }, () => integer2(8)),
    rewardInfos: Array.from({ length: 2 }, () => readRewardInfo())
  });
  return readPool();
}
var SOL_TOKEN_ACCOUNT, METEORA_DAMM_V2_PROGRAM_ID, METEORA_DAMM_V2_AUTHORITY, METEORA_DAMM_V2_SWAP_DISCRIMINATOR, METEORA_DAMM_V2_SWAP2_DISCRIMINATOR, METEORA_DAMM_V2_SYSVAR_INSTRUCTIONS, METEORA_DAMM_V2_EVENT_AUTHORITY_SEED, METEORA_POOL_SIZE;
var init_meteora_damm_v2_builder = __esm({
  "src/instruction/meteora_damm_v2_builder.ts"() {
    "use strict";
    SOL_TOKEN_ACCOUNT = new PublicKey2("So11111111111111111111111111111111111111111");
    METEORA_DAMM_V2_PROGRAM_ID = new PublicKey2(
      "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"
    );
    METEORA_DAMM_V2_AUTHORITY = new PublicKey2(
      "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC"
    );
    METEORA_DAMM_V2_SWAP_DISCRIMINATOR = Buffer.from([
      248,
      198,
      158,
      145,
      225,
      117,
      135,
      200
    ]);
    METEORA_DAMM_V2_SWAP2_DISCRIMINATOR = Buffer.from([
      65,
      75,
      63,
      76,
      235,
      91,
      91,
      136
    ]);
    METEORA_DAMM_V2_SYSVAR_INSTRUCTIONS = new PublicKey2(
      "Sysvar1nstructions1111111111111111111111111"
    );
    METEORA_DAMM_V2_EVENT_AUTHORITY_SEED = Buffer.from("__event_authority");
    METEORA_POOL_SIZE = 1104;
  }
});

// src/constants/index.ts
import { PublicKey as PublicKey4 } from "@solana/web3.js";
var SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_PROGRAM_2022, SOL_TOKEN_ACCOUNT2, WSOL_TOKEN_ACCOUNT, USD1_TOKEN_ACCOUNT, USDC_TOKEN_ACCOUNT, ASSOCIATED_TOKEN_PROGRAM, RENT, PUMPFUN_PROGRAM, PUMPSWAP_PROGRAM_ID, BONK_PROGRAM, RAYDIUM_CPMM_PROGRAM, RAYDIUM_AMM_V4_PROGRAM, METEORA_DAMM_V2_PROGRAM, SDK_FEE_RECIPIENT, SDK_MAYHEM_FEE_RECIPIENTS, PUMPFUN_DISCRIMINATORS, PUMPSWAP_DISCRIMINATORS;
var init_constants = __esm({
  "src/constants/index.ts"() {
    "use strict";
    SYSTEM_PROGRAM = new PublicKey4("11111111111111111111111111111111");
    TOKEN_PROGRAM = new PublicKey4("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    TOKEN_PROGRAM_2022 = new PublicKey4("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    SOL_TOKEN_ACCOUNT2 = new PublicKey4("So11111111111111111111111111111111111111111");
    WSOL_TOKEN_ACCOUNT = new PublicKey4("So11111111111111111111111111111111111111112");
    USD1_TOKEN_ACCOUNT = new PublicKey4("USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB");
    USDC_TOKEN_ACCOUNT = new PublicKey4("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    ASSOCIATED_TOKEN_PROGRAM = new PublicKey4("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    RENT = new PublicKey4("SysvarRent111111111111111111111111111111111");
    PUMPFUN_PROGRAM = new PublicKey4("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    PUMPSWAP_PROGRAM_ID = new PublicKey4("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
    BONK_PROGRAM = new PublicKey4("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
    RAYDIUM_CPMM_PROGRAM = new PublicKey4("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
    RAYDIUM_AMM_V4_PROGRAM = new PublicKey4("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
    METEORA_DAMM_V2_PROGRAM = new PublicKey4("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
    SDK_FEE_RECIPIENT = new PublicKey4("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
    SDK_MAYHEM_FEE_RECIPIENTS = [
      new PublicKey4("GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS"),
      new PublicKey4("4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6"),
      new PublicKey4("8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR"),
      new PublicKey4("4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH"),
      new PublicKey4("8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6"),
      new PublicKey4("Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk"),
      new PublicKey4("463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq"),
      new PublicKey4("6AUH3WEHucYZyC61hqpqYUWVto5qA5hjHuNQ32GNnNxA")
    ];
    PUMPFUN_DISCRIMINATORS = {
      BUY: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
      SELL: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
      BUY_EXACT_SOL_IN: Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]),
      CLAIM_CASHBACK: Buffer.from([37, 58, 35, 126, 190, 53, 228, 197])
    };
    PUMPSWAP_DISCRIMINATORS = {
      BUY: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
      BUY_EXACT_QUOTE_IN: Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]),
      SELL: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
      DEPOSIT: Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]),
      WITHDRAW: Buffer.from([183, 18, 70, 156, 148, 109, 161, 34])
    };
  }
});

// src/calc/pumpfun_exact.ts
function unsigned(n, max3, label) {
  if (typeof n !== "bigint" || n < 0n || n > max3) throw new RangeError(`${label} outside unsigned range`);
}
function pumpFunBuyExact(virtualToken, virtualQuote, realToken, amount, totalFeeBps = 95n) {
  for (const n of [virtualToken, virtualQuote, realToken]) unsigned(n, U128, "reserve");
  unsigned(amount, U64, "amount");
  unsigned(totalFeeBps, U64, "fee");
  if (amount === 0n || virtualToken === 0n) return 0n;
  const net = amount * 10000n / (totalFeeBps + 10000n), curveIn = net > 0n ? net - 1n : 0n;
  if (curveIn === 0n) return 0n;
  const denominator = virtualQuote + curveIn;
  if (denominator > U128 || denominator === 0n) return 0n;
  const numerator = curveIn * virtualToken;
  const out = numerator > U128 ? 0n : numerator / denominator;
  return out < realToken ? out < U64 ? out : U64 : realToken < U64 ? realToken : U64;
}
function pumpFunSellExact(virtualToken, virtualQuote, amount, totalFeeBps = 95n) {
  for (const n of [virtualToken, virtualQuote]) unsigned(n, U128, "reserve");
  unsigned(amount, U64, "amount");
  unsigned(totalFeeBps, U64, "fee");
  if (amount === 0n || virtualToken === 0n) return 0n;
  const numerator = amount * virtualQuote;
  if (numerator > U128) return U64;
  const sum = virtualToken + amount, denominator = sum > U128 ? 1n : sum;
  const gross = numerator / denominator, fee = (gross * totalFeeBps + 9999n) / 10000n;
  const out = gross > fee ? gross - fee : 0n;
  return out < U64 ? out : U64;
}
var U64, U128;
var init_pumpfun_exact = __esm({
  "src/calc/pumpfun_exact.ts"() {
    "use strict";
    U64 = (1n << 64n) - 1n;
    U128 = (1n << 128n) - 1n;
  }
});

// src/calc/dlmm.ts
function uint(v, bits) {
  if (typeof v !== "bigint" || v < 0n || v >= 1n << BigInt(bits))
    throw Error("DLMM unsigned integer outside range");
}
function integer(v, lo, hi) {
  if (!Number.isSafeInteger(v) || v < lo || v > hi)
    throw Error("DLMM integer outside range");
}
function dlmmSwapExactIn(pool, bins, loadedArrays, amount, timestamp, swapForY, supportOrders = true, strict = true, exhaustive = false) {
  uint(amount, 64);
  uint(timestamp, 63);
  if ([swapForY, supportOrders, strict, exhaustive].some(
    (v) => typeof v !== "boolean"
  ))
    throw Error("DLMM flags must be boolean");
  const sp = pool.static, vp = pool.variable;
  integer(pool.activeId, -443636, 443636);
  integer(pool.binStep, 1, 65535);
  integer(pool.feeMode, 0, 1);
  for (const [v, hi2] of [
    [sp.baseFactor, 65535],
    [sp.power, 18],
    [sp.control, 4294967295],
    [sp.maximumVolatility, 4294967295],
    [sp.filterPeriod, 65535],
    [sp.decayPeriod, 65535],
    [sp.reductionFactor, 1e4],
    [vp.volatility, 4294967295],
    [vp.reference, 4294967295]
  ])
    integer(v, 0, hi2);
  integer(vp.indexReference, -2147483648, 2147483647);
  uint(vp.lastTimestamp, 63);
  if (vp.lastTimestamp > timestamp) throw Error("Invalid DLMM fee timestamp");
  const loaded = /* @__PURE__ */ new Set();
  for (const i of loadedArrays) {
    integer(i, -6338, 6337);
    if (i * 70 > 443636 || (i + 1) * 70 <= -443636 || loaded.has(i))
      throw Error("Invalid/duplicate DLMM array");
    loaded.add(i);
  }
  const byId = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
  const liveIds = [];
  for (const b of bins) {
    integer(b.binId, -443636, 443636);
    if (seen.has(b.binId) || !loaded.has(Math.floor(b.binId / 70)))
      throw Error("Duplicate/unloaded DLMM bin");
    seen.add(b.binId);
    for (const v of [b.amountX, b.amountY, b.openOrder, b.processedOrder])
      uint(v, 64);
    uint(b.price, 128);
    integer(b.askSide, 0, 255);
    if (b.price === 0n) {
      if (b.amountX || b.amountY || b.openOrder || b.processedOrder)
        throw Error("Zero DLMM price with liquidity");
    } else {
      byId.set(b.binId, b);
      const relevant = supportOrders && (swapForY && b.askSide === 0 || !swapForY && b.askSide !== 0);
      if ((swapForY ? b.amountY : b.amountX) !== 0n || relevant && (b.processedOrder !== 0n || b.openOrder !== 0n))
        liveIds.push(b.binId);
    }
  }
  liveIds.sort((a, b) => a - b);
  let ref = BigInt(vp.reference), index = vp.indexReference;
  const elapsed = timestamp - vp.lastTimestamp;
  if (elapsed >= BigInt(sp.filterPeriod)) {
    index = pool.activeId;
    ref = elapsed < BigInt(sp.decayPeriod) ? BigInt(vp.volatility) * BigInt(sp.reductionFactor) / 10000n : 0n;
  }
  const feeInput = pool.feeMode === 0 || !swapForY, step = swapForY ? -1 : 1;
  const binStep = BigInt(pool.binStep), control = BigInt(sp.control), maximumVolatility = BigInt(sp.maximumVolatility), baseRate = BigInt(sp.baseFactor) * binStep * 10n * 10n ** BigInt(sp.power);
  const arrayBoundary = (current2) => swapForY ? Math.floor(current2 / 70) * 70 - 1 : (Math.floor(current2 / 70) + 1) * 70;
  const advanceEmpty = (current2) => {
    let lo2 = 0, hi2 = liveIds.length;
    while (lo2 < hi2) {
      const middle = Math.floor((lo2 + hi2) / 2);
      if (swapForY ? liveIds[middle] < current2 : liveIds[middle] <= current2) lo2 = middle + 1;
      else hi2 = middle;
    }
    const next = liveIds[swapForY ? lo2 - 1 : lo2];
    return next !== void 0 && Math.floor(next / 70) === Math.floor(current2 / 70) ? next : arrayBoundary(current2);
  };
  let current = pool.activeId, remaining = amount, total = 0n, crossed = 0;
  const lo = loaded.size ? Math.min(...loaded) * 70 : 0, hi = loaded.size ? Math.max(...loaded) * 70 + 69 : -1;
  while (remaining > 0n && current >= -443636 && current <= 443636) {
    if (!loaded.has(Math.floor(current / 70))) {
      if (exhaustive) {
        if (current < lo || current > hi) break;
        current = arrayBoundary(current);
        continue;
      }
      const partial = {
        amountOut: total,
        remainingIn: remaining,
        binsCrossed: crossed,
        complete: false,
        missingBinId: current
      };
      if (strict) throw new InsufficientDlmmArrays(partial);
      return partial;
    }
    const b = byId.get(current);
    if (!b) {
      current = advanceEmpty(current);
      continue;
    }
    const reserve = swapForY ? b.amountY : b.amountX, relevant = supportOrders && (swapForY && b.askSide === 0 || !swapForY && b.askSide !== 0), tiers = [
      reserve,
      relevant ? b.processedOrder : 0n,
      relevant ? b.openOrder : 0n
    ];
    if (!tiers.some((r) => r !== 0n)) {
      current = advanceEmpty(current);
      continue;
    }
    const ramped = ref + BigInt(Math.abs(index - current)) * 10000n, volatility = ramped < maximumVolatility ? ramped : maximumVolatility, variable = ceil(
      (volatility * binStep) ** 2n * control,
      100000000000n
    ), uncapped = baseRate + variable, rate = uncapped < 100000000n ? uncapped : 100000000n;
    let left = feeInput ? remaining - ceil(remaining * rate, PRECISION) : remaining, used = 0n, out = 0n;
    const numerator = swapForY ? Q64 : b.price, denominator = swapForY ? b.price : Q64;
    for (const r of tiers) {
      if (left === 0n) break;
      if (r === 0n) continue;
      const needed = ceil(r * numerator, denominator), consumed = left >= needed ? needed : left, produced = left >= needed ? r : left * denominator / numerator;
      left -= consumed;
      used += consumed;
      out += produced;
    }
    total += feeInput ? out : out - ceil(out * rate, PRECISION);
    if (total >= 1n << 64n) throw Error("DLMM output overflows u64");
    if (left !== 0n) {
      remaining -= feeInput ? ceil(used * PRECISION, PRECISION - rate) : used;
      crossed++;
      current += step;
    } else
      return {
        amountOut: total,
        remainingIn: 0n,
        binsCrossed: crossed + 1,
        complete: true
      };
  }
  return {
    amountOut: total,
    remainingIn: remaining,
    binsCrossed: crossed + 1,
    complete: true
  };
}
var InsufficientDlmmArrays, Q64, PRECISION, ceil;
var init_dlmm = __esm({
  "src/calc/dlmm.ts"() {
    "use strict";
    InsufficientDlmmArrays = class extends Error {
      constructor(partial) {
        super(`Missing DLMM bin array for bin ${partial.missingBinId}`);
        this.partial = partial;
      }
      partial;
    };
    Q64 = 1n << 64n;
    PRECISION = 1000000000n;
    ceil = (a, b) => (a + b - 1n) / b;
  }
});

// src/calc/index.ts
function validateAmount(amount, name = "amount") {
  if (typeof amount !== "bigint") throw new CalculationError(`${name} must be bigint`);
  if (amount < BigInt(0)) {
    throw new CalculationError(`${name} cannot be negative: ${amount}`);
  }
  if (amount > MAX_SAFE_BIGINT) {
    throw new CalculationError(`${name} exceeds maximum safe value: ${amount}`);
  }
}
function computeFee(amount, feeBasisPoints) {
  validateAmount(amount, "amount");
  validateAmount(feeBasisPoints, "fee basis points");
  const result = (amount * feeBasisPoints + 9999n) / 10000n;
  validateAmount(result, "fee");
  return result;
}
function calculateWithSlippageBuy(amount, basisPoints) {
  validateAmount(amount, "amount");
  validateAmount(basisPoints, "slippage basis points");
  const bps = basisPoints > MAX_SLIPPAGE_BASIS_POINTS ? MAX_SLIPPAGE_BASIS_POINTS : basisPoints;
  const result = amount + amount * bps / 10000n;
  return result > MAX_SAFE_BIGINT ? MAX_SAFE_BIGINT : result;
}
function calculateWithSlippageSell(amount, basisPoints) {
  validateAmount(amount, "amount");
  validateAmount(basisPoints, "slippage basis points");
  const bps = basisPoints > MAX_SLIPPAGE_BASIS_POINTS ? MAX_SLIPPAGE_BASIS_POINTS : basisPoints;
  return amount - amount * bps / 10000n;
}
function pumpSwapFeeBasisPoints(lpFeeBasisPoints, protocolFeeBasisPoints, coinCreatorFeeBasisPoints) {
  return { lpFeeBasisPoints, protocolFeeBasisPoints, coinCreatorFeeBasisPoints };
}
function legacyPumpSwapFeeBasisPoints(hasCoinCreator) {
  return pumpSwapFeeBasisPoints(
    PUMPSWAP_CONSTANTS.LP_FEE_BASIS_POINTS,
    PUMPSWAP_CONSTANTS.PROTOCOL_FEE_BASIS_POINTS,
    hasCoinCreator ? PUMPSWAP_CONSTANTS.COIN_CREATOR_FEE_BASIS_POINTS : BigInt(0)
  );
}
function effectiveQuoteReserves(quoteVaultBalance, virtualQuoteReserves) {
  if (quoteVaultBalance < BigInt(0) || quoteVaultBalance > MAX_SAFE_BIGINT) {
    throw new CalculationError(`Invalid u64 quote vault balance: ${quoteVaultBalance}`);
  }
  if (virtualQuoteReserves < I128_MIN_BIGINT || virtualQuoteReserves > I128_MAX_BIGINT) {
    throw new CalculationError(
      `Invalid signed i128 virtual quote reserves: ${virtualQuoteReserves}`
    );
  }
  const effective = quoteVaultBalance + virtualQuoteReserves;
  if (effective < BigInt(0) || effective > MAX_SAFE_BIGINT) {
    throw new CalculationError(
      `Invalid effective quote reserves: raw=${quoteVaultBalance}, virtual=${virtualQuoteReserves}`
    );
  }
  return effective;
}
function validatePumpSwapInputs(amount, slippage, baseReserve, quoteReserve, fees) {
  for (const [name, value] of Object.entries({
    amount,
    slippage,
    baseReserve,
    quoteReserve,
    lpFee: fees.lpFeeBasisPoints,
    protocolFee: fees.protocolFeeBasisPoints,
    creatorFee: fees.coinCreatorFeeBasisPoints
  })) {
    validateAmount(value, name);
  }
}
function buyQuoteInputInternalWithFees(quote, slippageBasisPoints, baseReserve, quoteReserve, virtualQuoteReserves, feeBasisPoints) {
  validatePumpSwapInputs(quote, slippageBasisPoints, baseReserve, quoteReserve, feeBasisPoints);
  if (baseReserve === BigInt(0) || quoteReserve === BigInt(0)) {
    throw new Error("Invalid input: reserves cannot be zero");
  }
  const effectiveQuoteReserve = effectiveQuoteReserves(quoteReserve, virtualQuoteReserves);
  if (effectiveQuoteReserve === BigInt(0)) {
    throw new CalculationError("Invalid effective quote reserves: depleted pool");
  }
  const totalFeeBps = feeBasisPoints.lpFeeBasisPoints + feeBasisPoints.protocolFeeBasisPoints + feeBasisPoints.coinCreatorFeeBasisPoints;
  validateAmount(totalFeeBps, "total fee basis points");
  const denominator = BigInt(1e4) + totalFeeBps;
  validateAmount(denominator, "fee denominator");
  let effectiveQuote = quote * BigInt(1e4) / denominator;
  const lpFee = computeFee(effectiveQuote, feeBasisPoints.lpFeeBasisPoints);
  const protocolFee = computeFee(effectiveQuote, feeBasisPoints.protocolFeeBasisPoints);
  const coinCreatorFee = computeFee(effectiveQuote, feeBasisPoints.coinCreatorFeeBasisPoints);
  const totalWithFees = effectiveQuote + lpFee + protocolFee + coinCreatorFee;
  if (totalWithFees > quote) {
    effectiveQuote -= totalWithFees - quote;
    if (effectiveQuote < BigInt(0)) {
      throw new CalculationError("Quote input is too small to cover fees");
    }
  }
  if (effectiveQuote === 0n) throw new CalculationError("Quote input is too small after fees");
  const inputAmount = effectiveQuote - 1n;
  const numerator = baseReserve * inputAmount;
  const denominatorEffective = effectiveQuoteReserve + inputAmount;
  if (denominatorEffective === BigInt(0)) {
    throw new Error("Pool would be depleted");
  }
  const baseAmountOut = numerator / denominatorEffective;
  const maxQuote = calculateWithSlippageBuy(quote, slippageBasisPoints);
  return {
    base: baseAmountOut,
    internalQuoteWithoutFees: effectiveQuote,
    maxQuote
  };
}
function sellBaseInputInternalWithFees(base, slippageBasisPoints, baseReserve, quoteReserve, virtualQuoteReserves, feeBasisPoints) {
  validatePumpSwapInputs(base, slippageBasisPoints, baseReserve, quoteReserve, feeBasisPoints);
  if (baseReserve === BigInt(0) || quoteReserve === BigInt(0)) {
    throw new Error("Invalid input: reserves cannot be zero");
  }
  const effectiveQuoteReserve = effectiveQuoteReserves(quoteReserve, virtualQuoteReserves);
  if (effectiveQuoteReserve === BigInt(0)) {
    throw new CalculationError("Invalid effective quote reserves: depleted pool");
  }
  const quoteAmountOut = effectiveQuoteReserve * base / (baseReserve + base);
  const lpFee = computeFee(quoteAmountOut, feeBasisPoints.lpFeeBasisPoints);
  const protocolFee = computeFee(quoteAmountOut, feeBasisPoints.protocolFeeBasisPoints);
  const coinCreatorFee = computeFee(quoteAmountOut, feeBasisPoints.coinCreatorFeeBasisPoints);
  const totalFees = lpFee + protocolFee + coinCreatorFee;
  validateAmount(totalFees, "total fees");
  if (totalFees > quoteAmountOut) {
    throw new Error("Fees exceed output");
  }
  const quoteVaultOutflow = quoteAmountOut - lpFee;
  if (quoteVaultOutflow > quoteReserve) {
    throw new Error("Insufficient real quote reserves to cover the sell output");
  }
  const finalQuote = quoteAmountOut - totalFees;
  const minQuote = calculateWithSlippageSell(finalQuote, slippageBasisPoints);
  return {
    uiQuote: finalQuote,
    minQuote,
    internalQuoteAmountOut: quoteAmountOut
  };
}
var MAX_SAFE_BIGINT, MAX_BASIS_POINTS, I128_MIN_BIGINT, I128_MAX_BIGINT, MAX_SLIPPAGE_BASIS_POINTS, CalculationError, PUMPFUN_CONSTANTS, PUMPSWAP_CONSTANTS, BONK_CONSTANTS, RAYDIUM_CPMM_FEE_RATE_DENOMINATOR, RAYDIUM_CPMM_TRADE_FEE_RATE, RAYDIUM_CPMM_CREATOR_FEE_RATE, RAYDIUM_CPMM_PROTOCOL_FEE_RATE, RAYDIUM_CPMM_FUND_FEE_RATE, RAYDIUM_AMM_V4_SWAP_FEE_NUMERATOR, RAYDIUM_AMM_V4_SWAP_FEE_DENOMINATOR, RAYDIUM_AMM_V4_TRADE_FEE_NUMERATOR, RAYDIUM_AMM_V4_TRADE_FEE_DENOMINATOR;
var init_calc = __esm({
  "src/calc/index.ts"() {
    "use strict";
    init_dlmm();
    MAX_SAFE_BIGINT = BigInt("18446744073709551615");
    MAX_BASIS_POINTS = BigInt(1e4);
    I128_MIN_BIGINT = -(BigInt(1) << BigInt(127));
    I128_MAX_BIGINT = (BigInt(1) << BigInt(127)) - BigInt(1);
    MAX_SLIPPAGE_BASIS_POINTS = BigInt(9999);
    CalculationError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "CalculationError";
      }
    };
    PUMPFUN_CONSTANTS = {
      FEE_BASIS_POINTS: BigInt(95),
      // Protocol fee (NOT 100!)
      CREATOR_FEE: BigInt(30),
      // Creator fee (NOT 50!)
      INITIAL_VIRTUAL_TOKEN_RESERVES: BigInt("1073000000000000"),
      INITIAL_VIRTUAL_SOL_RESERVES: BigInt("30000000000"),
      INITIAL_REAL_TOKEN_RESERVES: BigInt("793100000000000"),
      // Fixed: was 793000000000000
      TOKEN_TOTAL_SUPPLY: BigInt("1000000000000000")
    };
    PUMPSWAP_CONSTANTS = {
      LP_FEE_BASIS_POINTS: BigInt(25),
      // 0.25% (was 20)
      PROTOCOL_FEE_BASIS_POINTS: BigInt(5),
      // 0.05% (was 20)
      COIN_CREATOR_FEE_BASIS_POINTS: BigInt(5)
      // 0.05% (was 10)
    };
    BONK_CONSTANTS = {
      PROTOCOL_FEE_RATE: BigInt(25),
      // 0.25%
      PLATFORM_FEE_RATE: BigInt(100),
      // 1%
      SHARE_FEE_RATE: BigInt(0),
      // 0%
      DEFAULT_VIRTUAL_BASE: BigInt("1073025605596382"),
      DEFAULT_VIRTUAL_QUOTE: BigInt("30000852951")
    };
    RAYDIUM_CPMM_FEE_RATE_DENOMINATOR = BigInt(1e6);
    RAYDIUM_CPMM_TRADE_FEE_RATE = BigInt(2500);
    RAYDIUM_CPMM_CREATOR_FEE_RATE = BigInt(0);
    RAYDIUM_CPMM_PROTOCOL_FEE_RATE = BigInt(12e4);
    RAYDIUM_CPMM_FUND_FEE_RATE = BigInt(4e4);
    RAYDIUM_AMM_V4_SWAP_FEE_NUMERATOR = BigInt(25);
    RAYDIUM_AMM_V4_SWAP_FEE_DENOMINATOR = BigInt(1e4);
    RAYDIUM_AMM_V4_TRADE_FEE_NUMERATOR = BigInt(25);
    RAYDIUM_AMM_V4_TRADE_FEE_DENOMINATOR = BigInt(1e4);
  }
});

// src/instruction/pumpswap.ts
import {
  PublicKey as PublicKey5,
  TransactionInstruction as TransactionInstruction3,
  SystemProgram as SystemProgram3,
  SYSVAR_RENT_PUBKEY as SYSVAR_RENT_PUBKEY2
} from "@solana/web3.js";
function getPoolV2PDA(baseMint) {
  const [pda] = PublicKey5.findProgramAddressSync(
    [POOL_V2_SEED, baseMint.toBuffer()],
    PUMPSWAP_PROGRAM
  );
  return pda;
}
function getPumpPoolAuthorityPDA(mint) {
  const [pda] = PublicKey5.findProgramAddressSync(
    [POOL_AUTHORITY_SEED, mint.toBuffer()],
    PUMPSWAP_PUMP_PROGRAM_ID
  );
  return pda;
}
function getCoinCreatorVaultAuthority(coinCreator) {
  const [pda] = PublicKey5.findProgramAddressSync(
    [CREATOR_VAULT_SEED, coinCreator.toBuffer()],
    PUMPSWAP_PROGRAM
  );
  return pda;
}
function getCoinCreatorVaultAta(coinCreator, quoteMint, quoteTokenProgram = TOKEN_PROGRAM) {
  const authority = getCoinCreatorVaultAuthority(coinCreator);
  return getAssociatedTokenAddress(authority, quoteMint, quoteTokenProgram);
}
function getUserVolumeAccumulatorPDA(user) {
  const [pda] = PublicKey5.findProgramAddressSync(
    [USER_VOLUME_ACCUMULATOR_SEED, user.toBuffer()],
    PUMPSWAP_PROGRAM
  );
  return pda;
}
function getAssociatedTokenAddress(owner, mint, tokenProgram = TOKEN_PROGRAM) {
  const [ata] = PublicKey5.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM
  );
  return ata;
}
function decodePoolPayload(data) {
  if (data.length < POOL_SIZE && data.length !== LEGACY_POOL_SIZE) {
    return null;
  }
  try {
    let offset = 0;
    const poolBump = data.readUInt8(offset);
    offset += 1;
    const index = data.readUInt16LE(offset);
    offset += 2;
    const creator = new PublicKey5(data.subarray(offset, offset + 32));
    offset += 32;
    const baseMint = new PublicKey5(data.subarray(offset, offset + 32));
    offset += 32;
    const quoteMint = new PublicKey5(data.subarray(offset, offset + 32));
    offset += 32;
    const lpMint = new PublicKey5(data.subarray(offset, offset + 32));
    offset += 32;
    const poolBaseTokenAccount = new PublicKey5(data.subarray(offset, offset + 32));
    offset += 32;
    const poolQuoteTokenAccount = new PublicKey5(data.subarray(offset, offset + 32));
    offset += 32;
    const lpSupply = data.readBigUInt64LE(offset);
    offset += 8;
    const coinCreator = new PublicKey5(data.subarray(offset, offset + 32));
    offset += 32;
    const isMayhemMode = data.readUInt8(offset) === 1;
    offset += 1;
    const isCashbackCoin = data.readUInt8(offset) === 1;
    offset += 1;
    const virtualQuoteReserves = data.length >= POOL_SIZE ? readI128LE(data, offset) : BigInt(0);
    return {
      poolBump,
      index,
      creator,
      baseMint,
      quoteMint,
      lpMint,
      poolBaseTokenAccount,
      poolQuoteTokenAccount,
      lpSupply,
      coinCreator,
      isMayhemMode,
      isCashbackCoin,
      virtualQuoteReserves
    };
  } catch {
    return null;
  }
}
function readU128LE(data, offset) {
  const lo = data.readBigUInt64LE(offset);
  const hi = data.readBigUInt64LE(offset + 8);
  return lo + (hi << BigInt(64));
}
function readI128LE(data, offset) {
  const unsigned5 = readU128LE(data, offset);
  const signBit = BigInt(1) << BigInt(127);
  return unsigned5 >= signBit ? unsigned5 - (BigInt(1) << BigInt(128)) : unsigned5;
}
function decodeFees(data, offset) {
  return pumpSwapFeeBasisPoints(
    data.readBigUInt64LE(offset),
    data.readBigUInt64LE(offset + 8),
    data.readBigUInt64LE(offset + 16)
  );
}
function decodeFeeTiers(data, offset) {
  const len = data.readUInt32LE(offset);
  offset += 4;
  const tiers = [];
  for (let i = 0; i < len; i += 1) {
    const marketCapLamportsThreshold = readU128LE(data, offset);
    offset += 16;
    const fees = decodeFees(data, offset);
    offset += 24;
    tiers.push({ marketCapLamportsThreshold, fees });
  }
  return { tiers, offset };
}
function decodeFeeConfig(data) {
  if (data.length < 8 || !data.subarray(0, 8).equals(Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]))) return null;
  try {
    let offset = 8;
    offset += 1;
    offset += 32;
    const flatFees = decodeFees(data, offset);
    offset += 24;
    const decodedFeeTiers = decodeFeeTiers(data, offset);
    offset = decodedFeeTiers.offset;
    const decodedStableFeeTiers = decodeFeeTiers(data, offset);
    return {
      flatFees,
      feeTiers: decodedFeeTiers.tiers,
      stableFeeTiers: decodedStableFeeTiers.tiers
    };
  } catch {
    return null;
  }
}
function calculateFeeTier(feeTiers, marketCapLamports) {
  const first = feeTiers[0];
  if (!first) return null;
  if (marketCapLamports < first.marketCapLamportsThreshold) {
    return first.fees;
  }
  for (let i = feeTiers.length - 1; i >= 0; i -= 1) {
    const tier = feeTiers[i];
    if (marketCapLamports >= tier.marketCapLamportsThreshold) {
      return tier.fees;
    }
  }
  return first.fees;
}
function poolMarketCapLamports(baseMintSupply, baseReserve, quoteReserve) {
  if (baseReserve === BigInt(0)) return null;
  return quoteReserve * baseMintSupply / baseReserve;
}
function isCanonicalPumpPool(baseMint, poolCreator) {
  return getPumpPoolAuthorityPDA(baseMint).equals(poolCreator);
}
function computePumpSwapFeeBasisPoints(feeConfig, poolCreator, baseMint, baseMintSupply, baseReserve, quoteReserve) {
  if (!feeConfig) {
    return legacyPumpSwapFeeBasisPoints(true);
  }
  if (!isCanonicalPumpPool(baseMint, poolCreator)) {
    return feeConfig.flatFees;
  }
  if (baseMintSupply === null) {
    return legacyPumpSwapFeeBasisPoints(true);
  }
  const marketCap = poolMarketCapLamports(baseMintSupply, baseReserve, quoteReserve);
  if (marketCap === null) {
    return legacyPumpSwapFeeBasisPoints(true);
  }
  return calculateFeeTier(feeConfig.feeTiers, marketCap) ?? feeConfig.flatFees;
}
var PUMPSWAP_PROGRAM, PUMPSWAP_PUMP_PROGRAM_ID, PUMPSWAP_FEE_PROGRAM, PUMPSWAP_FEE_RECIPIENT, PUMPSWAP_GLOBAL_ACCOUNT, PUMPSWAP_EVENT_AUTHORITY, PUMPSWAP_GLOBAL_VOLUME_ACCUMULATOR, PUMPSWAP_FEE_CONFIG, PUMPSWAP_DEFAULT_COIN_CREATOR_VAULT_AUTHORITY, PUMPSWAP_MAYHEM_FEE_RECIPIENTS, PUMPSWAP_PROTOCOL_EXTRA_FEE_RECIPIENTS, PUMPSWAP_BUY_DISCRIMINATOR, PUMPSWAP_BUY_EXACT_QUOTE_IN_DISCRIMINATOR, PUMPSWAP_SELL_DISCRIMINATOR, PUMPSWAP_CLAIM_CASHBACK_DISCRIMINATOR, PUMPSWAP_POOL_DISCRIMINATOR, POOL_V2_SEED, POOL_SEED, POOL_AUTHORITY_SEED, USER_VOLUME_ACCUMULATOR_SEED, CREATOR_VAULT_SEED, FEE_CONFIG_SEED, GLOBAL_VOLUME_ACCUMULATOR_SEED, POOL_SIZE, LEGACY_POOL_SIZE;
var init_pumpswap = __esm({
  "src/instruction/pumpswap.ts"() {
    "use strict";
    init_constants();
    init_calc();
    PUMPSWAP_PROGRAM = new PublicKey5("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
    PUMPSWAP_PUMP_PROGRAM_ID = new PublicKey5("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    PUMPSWAP_FEE_PROGRAM = new PublicKey5("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
    PUMPSWAP_FEE_RECIPIENT = new PublicKey5("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
    PUMPSWAP_GLOBAL_ACCOUNT = new PublicKey5("ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
    PUMPSWAP_EVENT_AUTHORITY = new PublicKey5("GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR");
    PUMPSWAP_GLOBAL_VOLUME_ACCUMULATOR = new PublicKey5("C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw");
    PUMPSWAP_FEE_CONFIG = new PublicKey5("5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx");
    PUMPSWAP_DEFAULT_COIN_CREATOR_VAULT_AUTHORITY = new PublicKey5("8N3GDaZ2iwN65oxVatKTLPNooAVUJTbfiVJ1ahyqwjSk");
    PUMPSWAP_MAYHEM_FEE_RECIPIENTS = [
      new PublicKey5("GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS"),
      new PublicKey5("4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6"),
      new PublicKey5("8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR"),
      new PublicKey5("4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH"),
      new PublicKey5("8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6"),
      new PublicKey5("Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk"),
      new PublicKey5("463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq"),
      new PublicKey5("6AUH3WEHucYZyC61hqpqYUWVto5qA5hjHuNQ32GNnNxA")
    ];
    PUMPSWAP_PROTOCOL_EXTRA_FEE_RECIPIENTS = [
      new PublicKey5("5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD"),
      new PublicKey5("9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7"),
      new PublicKey5("GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL"),
      new PublicKey5("3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR"),
      new PublicKey5("5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6"),
      new PublicKey5("EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL"),
      new PublicKey5("5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD"),
      new PublicKey5("A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW")
    ];
    PUMPSWAP_BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
    PUMPSWAP_BUY_EXACT_QUOTE_IN_DISCRIMINATOR = Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]);
    PUMPSWAP_SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
    PUMPSWAP_CLAIM_CASHBACK_DISCRIMINATOR = Buffer.from([37, 58, 35, 126, 190, 53, 228, 197]);
    PUMPSWAP_POOL_DISCRIMINATOR = Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]);
    POOL_V2_SEED = Buffer.from("pool-v2");
    POOL_SEED = Buffer.from("pool");
    POOL_AUTHORITY_SEED = Buffer.from("pool-authority");
    USER_VOLUME_ACCUMULATOR_SEED = Buffer.from("user_volume_accumulator");
    CREATOR_VAULT_SEED = Buffer.from("creator_vault");
    FEE_CONFIG_SEED = Buffer.from("fee_config");
    GLOBAL_VOLUME_ACCUMULATOR_SEED = Buffer.from("global_volume_accumulator");
    POOL_SIZE = 253;
    LEGACY_POOL_SIZE = 244;
  }
});

// src/instruction/pumpfun_builder.ts
import {
  PublicKey as PublicKey12,
  Keypair as Keypair2,
  TransactionInstruction as TransactionInstruction9,
  SystemProgram as SystemProgram6
} from "@solana/web3.js";
function getBondingCurvePda(mint) {
  const [pda] = PublicKey12.findProgramAddressSync(
    [PUMPFUN_BONDING_CURVE_SEED, mint.toBuffer()],
    PUMPFUN_PROGRAM_ID
  );
  return pda;
}
function getCreatorVaultPda(creator) {
  const [pda] = PublicKey12.findProgramAddressSync(
    [PUMPFUN_CREATOR_VAULT_SEED, creator.toBuffer()],
    PUMPFUN_PROGRAM_ID
  );
  return pda;
}
function getPumpFunUserVolumeAccumulatorPda(user) {
  const [pda] = PublicKey12.findProgramAddressSync(
    [PUMPFUN_USER_VOLUME_ACCUMULATOR_SEED, user.toBuffer()],
    PUMPFUN_PROGRAM_ID
  );
  return pda;
}
function getPumpFunFeeSharingConfigPda(mint) {
  const [pda] = PublicKey12.findProgramAddressSync(
    [PUMPFUN_SHARING_CONFIG_SEED, mint.toBuffer()],
    PUMPFUN_FEE_PROGRAM
  );
  return pda;
}
function getRandomMayhemFeeRecipient() {
  const index = Math.floor(Math.random() * PUMPFUN_MAYHEM_FEE_RECIPIENTS.length);
  const recipient = PUMPFUN_MAYHEM_FEE_RECIPIENTS[index];
  if (!recipient) {
    return PUMPFUN_MAYHEM_FEE_RECIPIENTS[0];
  }
  return recipient;
}
function getStandardFeeRecipientRandom() {
  return PUMPFUN_FEE_RECIPIENT;
}
function getPumpFunBuybackFeeRecipientRandom() {
  const index = Math.floor(Math.random() * PUMPFUN_BUYBACK_FEE_RECIPIENTS.length);
  return PUMPFUN_BUYBACK_FEE_RECIPIENTS[index] ?? PUMPFUN_BUYBACK_FEE_RECIPIENTS[0];
}
function feeRecipientOkForBondingCurveMode(recipient, mayhem) {
  const reserved = PUMPFUN_MAYHEM_FEE_RECIPIENTS.some((k) => k.equals(recipient));
  const normal = PUMPFUN_STANDARD_FEE_RECIPIENTS.some((k) => k.equals(recipient));
  return mayhem ? reserved || !normal && !recipient.equals(PublicKey12.default) : normal || !reserved && !recipient.equals(PublicKey12.default);
}
function pumpFunFeeRecipientMeta(fromStream, isMayhemMode) {
  if (fromStream && feeRecipientOkForBondingCurveMode(fromStream, isMayhemMode)) {
    return fromStream;
  }
  return isMayhemMode ? getRandomMayhemFeeRecipient() : getStandardFeeRecipientRandom();
}
function calculateWithSlippageBuy2(amount, basisPoints) {
  const bps = basisPoints > MAX_SLIPPAGE_BPS ? MAX_SLIPPAGE_BPS : basisPoints;
  return amount + amount * bps / BigInt(1e4);
}
function calculateWithSlippageSell2(amount, basisPoints) {
  const bps = basisPoints > MAX_SLIPPAGE_BPS ? MAX_SLIPPAGE_BPS : basisPoints;
  const result = amount - amount * bps / BigInt(1e4);
  return result > BigInt(0) ? result : BigInt(1);
}
function isUsablePubkey(value) {
  return value !== void 0 && !value.equals(PublicKey12.default) && !value.equals(PHANTOM_DEFAULT_CREATOR_VAULT);
}
function effectiveCreatorForTrade(protocolParams) {
  if (isUsablePubkey(protocolParams.observedTradeCreator)) {
    return protocolParams.observedTradeCreator;
  }
  if (isUsablePubkey(protocolParams.bondingCurve.creator)) {
    return protocolParams.bondingCurve.creator;
  }
  return PublicKey12.default;
}
function resolveCreatorVaultForIx(protocolParams, mint) {
  if (isUsablePubkey(protocolParams.creatorVault)) {
    return protocolParams.creatorVault;
  }
  if (isUsablePubkey(protocolParams.feeSharingCreatorVaultIfActive)) {
    return protocolParams.feeSharingCreatorVaultIfActive;
  }
  const creator = effectiveCreatorForTrade(protocolParams);
  if (isUsablePubkey(creator)) {
    return getCreatorVaultPda(creator);
  }
  throw new Error(`creator_vault PDA derivation failed for mint ${mint.toBase58()}`);
}
function resolveCreatorVaultForSellV2(protocolParams, mint) {
  if (isUsablePubkey(protocolParams.creatorVault)) {
    return protocolParams.creatorVault;
  }
  if (isUsablePubkey(protocolParams.feeSharingCreatorVaultIfActive)) {
    return protocolParams.feeSharingCreatorVaultIfActive;
  }
  const curveCreator = protocolParams.bondingCurve.creator;
  if (isUsablePubkey(curveCreator)) {
    return getCreatorVaultPda(curveCreator);
  }
  throw new Error(`creator_vault PDA derivation failed (curve_creator=${String(curveCreator)}, mint=${mint.toBase58()})`);
}
function effectivePumpMintTokenProgram(mint, protocolParams) {
  if (mint.toBase58().endsWith("pump")) {
    return TOKEN_2022_PROGRAM_ID;
  }
  if (isUsablePubkey(protocolParams.tokenProgram)) {
    return protocolParams.tokenProgram;
  }
  return TOKEN_2022_PROGRAM_ID;
}
function effectiveQuoteMint(protocolParams) {
  const quote = isUsablePubkey(protocolParams.quoteMint) ? protocolParams.quoteMint : protocolParams.bondingCurve.quoteMint;
  if (!isUsablePubkey(quote) || quote.equals(SOL_TOKEN_ACCOUNT3)) return NATIVE_MINT;
  return quote;
}
function isSolQuoteMint(mint) {
  return mint.equals(SOL_TOKEN_ACCOUNT3) || mint.equals(NATIVE_MINT);
}
function validateV2BuyQuoteMint(inputMint, quoteMint) {
  if (isSolQuoteMint(quoteMint)) {
    if (inputMint.equals(SOL_TOKEN_ACCOUNT3) || inputMint.equals(NATIVE_MINT)) return;
  } else if (inputMint.equals(quoteMint)) {
    return;
  }
  throw new Error(
    `PumpFun V2 buy input_mint ${inputMint.toBase58()} does not match quote_mint ${quoteMint.toBase58()}; USDC quote pools must be bought with USDC, not SOL`
  );
}
function validateV2SellQuoteMint(outputMint, quoteMint) {
  if (isSolQuoteMint(quoteMint)) {
    if (outputMint.equals(SOL_TOKEN_ACCOUNT3) || outputMint.equals(NATIVE_MINT)) return;
  } else if (outputMint.equals(quoteMint)) {
    return;
  }
  throw new Error(
    `PumpFun V2 sell output_mint ${outputMint.toBase58()} does not match quote_mint ${quoteMint.toBase58()}; USDC quote pools settle to USDC, not SOL`
  );
}
function associatedTokenAddress(mint, owner, tokenProgram) {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}
function pushCreateOrWrapUserTokenAccount(instructions, payer, ata, mint, tokenProgram, amount) {
  instructions.push(
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ata,
      payer,
      mint,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  if (mint.equals(NATIVE_MINT)) {
    instructions.push(
      SystemProgram6.transfer({
        fromPubkey: payer,
        toPubkey: ata,
        lamports: amount
      })
    );
    instructions.push(createSyncNativeInstruction(ata));
  }
}
function getBuyTokenAmountFromSolAmount(amount, bondingCurve, creator) {
  return pumpFunBuyExact(bondingCurve.virtualTokenReserves, bondingCurve.virtualSolReserves, bondingCurve.realTokenReserves, amount, PUMPFUN_FEE_BASIS_POINTS + (isUsablePubkey(creator) ? PUMPFUN_CREATOR_FEE_BASIS_POINTS : 0n));
}
function getSellSolAmountFromTokenAmount(amount, bondingCurve, creator) {
  return pumpFunSellExact(bondingCurve.virtualTokenReserves, bondingCurve.virtualSolReserves, amount, PUMPFUN_FEE_BASIS_POINTS + (isUsablePubkey(creator) ? PUMPFUN_CREATOR_FEE_BASIS_POINTS : 0n));
}
function buildPumpFunBuyV2Instructions(params) {
  const {
    payer,
    inputMint = SOL_TOKEN_ACCOUNT3,
    outputMint,
    inputAmount,
    slippageBasisPoints = BigInt(1e3),
    fixedOutputAmount,
    createOutputMintAta = true,
    createInputMintAta = false,
    closeInputMintAta = false,
    protocolParams,
    useExactSolAmount = true
  } = params;
  if (inputAmount === 0n) {
    throw new Error("Amount cannot be zero");
  }
  const payerPubkey = payer instanceof Keypair2 ? payer.publicKey : payer;
  const instructions = [];
  const bondingCurve = protocolParams.bondingCurve;
  const creator = effectiveCreatorForTrade(protocolParams);
  const creatorVaultAccount = resolveCreatorVaultForIx(protocolParams, outputMint);
  const bondingCurveAddr = bondingCurve.account.equals(PublicKey12.default) || !bondingCurve.account ? getBondingCurvePda(outputMint) : bondingCurve.account;
  const baseTokenProgram = effectivePumpMintTokenProgram(outputMint, protocolParams);
  const quoteMint = effectiveQuoteMint(protocolParams);
  validateV2BuyQuoteMint(inputMint, quoteMint);
  const quoteTokenProgram = TOKEN_PROGRAM_ID;
  const associatedBaseBondingCurve = associatedTokenAddress(
    outputMint,
    bondingCurveAddr,
    baseTokenProgram
  );
  const associatedBaseUser = associatedTokenAddress(outputMint, payerPubkey, baseTokenProgram);
  const feeRecipientPk = pumpFunFeeRecipientMeta(
    protocolParams.feeRecipient,
    bondingCurve.isMayhemMode
  );
  const buybackFeeRecipient = getPumpFunBuybackFeeRecipientRandom();
  const associatedQuoteFeeRecipient = associatedTokenAddress(
    quoteMint,
    feeRecipientPk,
    quoteTokenProgram
  );
  const associatedQuoteBuybackFeeRecipient = associatedTokenAddress(
    quoteMint,
    buybackFeeRecipient,
    quoteTokenProgram
  );
  const associatedQuoteBondingCurve = associatedTokenAddress(
    quoteMint,
    bondingCurveAddr,
    quoteTokenProgram
  );
  const associatedQuoteUser = associatedTokenAddress(quoteMint, payerPubkey, quoteTokenProgram);
  const associatedCreatorVault = associatedTokenAddress(
    quoteMint,
    creatorVaultAccount,
    quoteTokenProgram
  );
  const sharingConfig = getPumpFunFeeSharingConfigPda(outputMint);
  const userVolumeAccumulator = getPumpFunUserVolumeAccumulatorPda(payerPubkey);
  const associatedUserVolumeAccumulator = associatedTokenAddress(
    quoteMint,
    userVolumeAccumulator,
    quoteTokenProgram
  );
  if (createOutputMintAta) {
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        payerPubkey,
        associatedBaseUser,
        payerPubkey,
        outputMint,
        baseTokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  const buyTokenAmount = fixedOutputAmount ? fixedOutputAmount : getBuyTokenAmountFromSolAmount(inputAmount, bondingCurve, creator);
  const maxSolCost = calculateWithSlippageBuy2(inputAmount, slippageBasisPoints);
  let data;
  let quoteAmountToFund;
  if (fixedOutputAmount !== void 0) {
    data = Buffer.alloc(24);
    PUMPFUN_BUY_V2_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(fixedOutputAmount, 8);
    data.writeBigUInt64LE(inputAmount, 16);
    quoteAmountToFund = inputAmount;
  } else if (useExactSolAmount) {
    const minTokensOut = calculateWithSlippageSell2(buyTokenAmount, slippageBasisPoints);
    data = Buffer.alloc(24);
    PUMPFUN_BUY_EXACT_QUOTE_IN_V2_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(inputAmount, 8);
    data.writeBigUInt64LE(minTokensOut, 16);
    quoteAmountToFund = inputAmount;
  } else {
    data = Buffer.alloc(24);
    PUMPFUN_BUY_V2_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(buyTokenAmount, 8);
    data.writeBigUInt64LE(maxSolCost, 16);
    quoteAmountToFund = maxSolCost;
  }
  if (createInputMintAta) {
    pushCreateOrWrapUserTokenAccount(
      instructions,
      payerPubkey,
      associatedQuoteUser,
      quoteMint,
      quoteTokenProgram,
      quoteAmountToFund
    );
  }
  const keys = [
    { pubkey: PUMPFUN_GLOBAL_ACCOUNT, isSigner: false, isWritable: false },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: quoteMint, isSigner: false, isWritable: false },
    { pubkey: baseTokenProgram, isSigner: false, isWritable: false },
    { pubkey: quoteTokenProgram, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: feeRecipientPk, isSigner: false, isWritable: true },
    { pubkey: associatedQuoteFeeRecipient, isSigner: false, isWritable: true },
    { pubkey: buybackFeeRecipient, isSigner: false, isWritable: false },
    { pubkey: associatedQuoteBuybackFeeRecipient, isSigner: false, isWritable: true },
    { pubkey: bondingCurveAddr, isSigner: false, isWritable: true },
    { pubkey: associatedBaseBondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedQuoteBondingCurve, isSigner: false, isWritable: true },
    { pubkey: payerPubkey, isSigner: true, isWritable: true },
    { pubkey: associatedBaseUser, isSigner: false, isWritable: true },
    { pubkey: associatedQuoteUser, isSigner: false, isWritable: true },
    { pubkey: creatorVaultAccount, isSigner: false, isWritable: true },
    { pubkey: associatedCreatorVault, isSigner: false, isWritable: true },
    { pubkey: sharingConfig, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_GLOBAL_VOLUME_ACCUMULATOR, isSigner: false, isWritable: true },
    { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
    { pubkey: associatedUserVolumeAccumulator, isSigner: false, isWritable: true },
    { pubkey: PUMPFUN_FEE_CONFIG, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_FEE_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: SystemProgram6.programId, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM_ID, isSigner: false, isWritable: false }
  ];
  instructions.push(
    new TransactionInstruction9({
      keys,
      programId: PUMPFUN_PROGRAM_ID,
      data
    })
  );
  if (closeInputMintAta && quoteMint.equals(NATIVE_MINT)) {
    instructions.push(
      createCloseAccountInstruction(
        associatedQuoteUser,
        payerPubkey,
        payerPubkey,
        [],
        quoteTokenProgram
      )
    );
  }
  return instructions;
}
function buildPumpFunSellV2Instructions(params) {
  const {
    payer,
    inputMint,
    outputMint = SOL_TOKEN_ACCOUNT3,
    inputAmount,
    slippageBasisPoints = BigInt(1e3),
    fixedOutputAmount,
    createOutputMintAta = false,
    closeInputMintAta = false,
    protocolParams
  } = params;
  if (inputAmount === 0n) {
    throw new Error("Amount cannot be zero");
  }
  const payerPubkey = payer instanceof Keypair2 ? payer.publicKey : payer;
  const instructions = [];
  const bondingCurve = protocolParams.bondingCurve;
  const creator = effectiveCreatorForTrade(protocolParams);
  const creatorVaultAccount = resolveCreatorVaultForSellV2(protocolParams, inputMint);
  const bondingCurveAddr = bondingCurve.account.equals(PublicKey12.default) || !bondingCurve.account ? getBondingCurvePda(inputMint) : bondingCurve.account;
  const baseTokenProgram = effectivePumpMintTokenProgram(inputMint, protocolParams);
  const quoteMint = effectiveQuoteMint(protocolParams);
  validateV2SellQuoteMint(outputMint, quoteMint);
  const quoteTokenProgram = TOKEN_PROGRAM_ID;
  const associatedBaseBondingCurve = associatedTokenAddress(
    inputMint,
    bondingCurveAddr,
    baseTokenProgram
  );
  const associatedBaseUser = associatedTokenAddress(inputMint, payerPubkey, baseTokenProgram);
  const feeRecipientPk = pumpFunFeeRecipientMeta(
    protocolParams.feeRecipient,
    bondingCurve.isMayhemMode
  );
  const buybackFeeRecipient = getPumpFunBuybackFeeRecipientRandom();
  const associatedQuoteFeeRecipient = associatedTokenAddress(
    quoteMint,
    feeRecipientPk,
    quoteTokenProgram
  );
  const associatedQuoteBuybackFeeRecipient = associatedTokenAddress(
    quoteMint,
    buybackFeeRecipient,
    quoteTokenProgram
  );
  const associatedQuoteBondingCurve = associatedTokenAddress(
    quoteMint,
    bondingCurveAddr,
    quoteTokenProgram
  );
  const associatedQuoteUser = associatedTokenAddress(quoteMint, payerPubkey, quoteTokenProgram);
  const associatedCreatorVault = associatedTokenAddress(
    quoteMint,
    creatorVaultAccount,
    quoteTokenProgram
  );
  const sharingConfig = getPumpFunFeeSharingConfigPda(inputMint);
  const userVolumeAccumulator = getPumpFunUserVolumeAccumulatorPda(payerPubkey);
  const associatedUserVolumeAccumulator = associatedTokenAddress(
    quoteMint,
    userVolumeAccumulator,
    quoteTokenProgram
  );
  if (createOutputMintAta) {
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        payerPubkey,
        associatedQuoteUser,
        payerPubkey,
        quoteMint,
        quoteTokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  const expectedSolOutput = getSellSolAmountFromTokenAmount(inputAmount, bondingCurve, creator);
  const minSolOutput = fixedOutputAmount ? fixedOutputAmount : calculateWithSlippageSell2(expectedSolOutput, slippageBasisPoints);
  const data = Buffer.alloc(24);
  PUMPFUN_SELL_V2_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(inputAmount, 8);
  data.writeBigUInt64LE(minSolOutput, 16);
  const keys = [
    { pubkey: PUMPFUN_GLOBAL_ACCOUNT, isSigner: false, isWritable: false },
    { pubkey: inputMint, isSigner: false, isWritable: false },
    { pubkey: quoteMint, isSigner: false, isWritable: false },
    { pubkey: baseTokenProgram, isSigner: false, isWritable: false },
    { pubkey: quoteTokenProgram, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: feeRecipientPk, isSigner: false, isWritable: true },
    { pubkey: associatedQuoteFeeRecipient, isSigner: false, isWritable: true },
    { pubkey: buybackFeeRecipient, isSigner: false, isWritable: false },
    { pubkey: associatedQuoteBuybackFeeRecipient, isSigner: false, isWritable: true },
    { pubkey: bondingCurveAddr, isSigner: false, isWritable: true },
    { pubkey: associatedBaseBondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedQuoteBondingCurve, isSigner: false, isWritable: true },
    { pubkey: payerPubkey, isSigner: true, isWritable: true },
    { pubkey: associatedBaseUser, isSigner: false, isWritable: true },
    { pubkey: associatedQuoteUser, isSigner: false, isWritable: true },
    { pubkey: creatorVaultAccount, isSigner: false, isWritable: true },
    { pubkey: associatedCreatorVault, isSigner: false, isWritable: true },
    { pubkey: sharingConfig, isSigner: false, isWritable: false },
    { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
    { pubkey: associatedUserVolumeAccumulator, isSigner: false, isWritable: true },
    { pubkey: PUMPFUN_FEE_CONFIG, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_FEE_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: SystemProgram6.programId, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM_ID, isSigner: false, isWritable: false }
  ];
  instructions.push(
    new TransactionInstruction9({
      keys,
      programId: PUMPFUN_PROGRAM_ID,
      data
    })
  );
  if (closeInputMintAta || protocolParams.closeTokenAccountWhenSell) {
    instructions.push(
      createCloseAccountInstruction(
        associatedBaseUser,
        payerPubkey,
        payerPubkey,
        [],
        baseTokenProgram
      )
    );
  }
  return instructions;
}
var SOL_TOKEN_ACCOUNT3, PUMPFUN_PROGRAM_ID, PUMPFUN_EVENT_AUTHORITY, PUMPFUN_FEE_PROGRAM, PUMPFUN_GLOBAL_VOLUME_ACCUMULATOR, PUMPFUN_FEE_CONFIG, PUMPFUN_GLOBAL_ACCOUNT, PUMPFUN_FEE_RECIPIENT, PUMPFUN_STANDARD_FEE_RECIPIENTS, PUMPFUN_PROTOCOL_EXTRA_FEE_RECIPIENTS, PUMPFUN_BUYBACK_FEE_RECIPIENTS, PUMPFUN_MAYHEM_FEE_RECIPIENTS, PUMPFUN_BUY_DISCRIMINATOR, PUMPFUN_BUY_EXACT_SOL_IN_DISCRIMINATOR, PUMPFUN_SELL_DISCRIMINATOR, PUMPFUN_BUY_V2_DISCRIMINATOR, PUMPFUN_SELL_V2_DISCRIMINATOR, PUMPFUN_BUY_EXACT_QUOTE_IN_V2_DISCRIMINATOR, PUMPFUN_CLAIM_CASHBACK_DISCRIMINATOR, PUMPFUN_BONDING_CURVE_SEED, PUMPFUN_BONDING_CURVE_V2_SEED, PUMPFUN_CREATOR_VAULT_SEED, PUMPFUN_USER_VOLUME_ACCUMULATOR_SEED, PUMPFUN_SHARING_CONFIG_SEED, MAX_SLIPPAGE_BPS, PUMPFUN_FEE_BASIS_POINTS, PUMPFUN_CREATOR_FEE_BASIS_POINTS, PHANTOM_DEFAULT_CREATOR_VAULT;
var init_pumpfun_builder = __esm({
  "src/instruction/pumpfun_builder.ts"() {
    "use strict";
    init_pumpfun_exact();
    init_spl_token();
    SOL_TOKEN_ACCOUNT3 = new PublicKey12("So11111111111111111111111111111111111111111");
    PUMPFUN_PROGRAM_ID = new PublicKey12(
      "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
    );
    PUMPFUN_EVENT_AUTHORITY = new PublicKey12(
      "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"
    );
    PUMPFUN_FEE_PROGRAM = new PublicKey12(
      "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
    );
    PUMPFUN_GLOBAL_VOLUME_ACCUMULATOR = new PublicKey12(
      "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y"
    );
    PUMPFUN_FEE_CONFIG = new PublicKey12(
      "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt"
    );
    PUMPFUN_GLOBAL_ACCOUNT = new PublicKey12(
      "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    );
    PUMPFUN_FEE_RECIPIENT = new PublicKey12(
      "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV"
    );
    PUMPFUN_STANDARD_FEE_RECIPIENTS = [
      PUMPFUN_FEE_RECIPIENT,
      new PublicKey12("7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ"),
      new PublicKey12("7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX"),
      new PublicKey12("9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz"),
      new PublicKey12("AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY"),
      new PublicKey12("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"),
      new PublicKey12("FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz"),
      new PublicKey12("G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP")
    ];
    PUMPFUN_PROTOCOL_EXTRA_FEE_RECIPIENTS = [
      new PublicKey12("5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD"),
      new PublicKey12("9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7"),
      new PublicKey12("GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL"),
      new PublicKey12("3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR"),
      new PublicKey12("5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6"),
      new PublicKey12("EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL"),
      new PublicKey12("5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD"),
      new PublicKey12("A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW")
    ];
    PUMPFUN_BUYBACK_FEE_RECIPIENTS = PUMPFUN_PROTOCOL_EXTRA_FEE_RECIPIENTS;
    PUMPFUN_MAYHEM_FEE_RECIPIENTS = [
      new PublicKey12("GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS"),
      new PublicKey12("4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6"),
      new PublicKey12("8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR"),
      new PublicKey12("4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH"),
      new PublicKey12("8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6"),
      new PublicKey12("Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk"),
      new PublicKey12("463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq"),
      new PublicKey12("6AUH3WEHucYZyC61hqpqYUWVto5qA5hjHuNQ32GNnNxA")
    ];
    PUMPFUN_BUY_DISCRIMINATOR = Buffer.from([
      102,
      6,
      61,
      18,
      1,
      218,
      235,
      234
    ]);
    PUMPFUN_BUY_EXACT_SOL_IN_DISCRIMINATOR = Buffer.from([
      56,
      252,
      116,
      8,
      158,
      223,
      205,
      95
    ]);
    PUMPFUN_SELL_DISCRIMINATOR = Buffer.from([
      51,
      230,
      133,
      164,
      1,
      127,
      131,
      173
    ]);
    PUMPFUN_BUY_V2_DISCRIMINATOR = Buffer.from([
      184,
      23,
      238,
      97,
      103,
      197,
      211,
      61
    ]);
    PUMPFUN_SELL_V2_DISCRIMINATOR = Buffer.from([
      93,
      246,
      130,
      60,
      231,
      233,
      64,
      178
    ]);
    PUMPFUN_BUY_EXACT_QUOTE_IN_V2_DISCRIMINATOR = Buffer.from([
      194,
      171,
      28,
      70,
      104,
      77,
      91,
      47
    ]);
    PUMPFUN_CLAIM_CASHBACK_DISCRIMINATOR = Buffer.from([
      37,
      58,
      35,
      126,
      190,
      53,
      228,
      197
    ]);
    PUMPFUN_BONDING_CURVE_SEED = Buffer.from("bonding-curve");
    PUMPFUN_BONDING_CURVE_V2_SEED = Buffer.from("bonding-curve-v2");
    PUMPFUN_CREATOR_VAULT_SEED = Buffer.from("creator-vault");
    PUMPFUN_USER_VOLUME_ACCUMULATOR_SEED = Buffer.from("user_volume_accumulator");
    PUMPFUN_SHARING_CONFIG_SEED = Buffer.from("sharing-config");
    MAX_SLIPPAGE_BPS = BigInt(9999);
    PUMPFUN_FEE_BASIS_POINTS = 95n;
    PUMPFUN_CREATOR_FEE_BASIS_POINTS = 30n;
    PHANTOM_DEFAULT_CREATOR_VAULT = new PublicKey12(
      "2DR3iqRPVThyRLVJnwjPW1qiGWrp8RUFfHVjMbZyhdNc"
    );
  }
});

// src/trading/cached_pumpfun_config.ts
import { PublicKey as PublicKey13 } from "@solana/web3.js";
function decodePumpFunSharingCreatorVault(data, mint) {
  const d = Buffer.from(data);
  if (d.length < 43 || !d.subarray(0, 8).equals(Buffer.from([216, 74, 9, 0, 56, 140, 93, 75]))) throw Error("Invalid PumpFun SharingConfig discriminator or size");
  if (!d.subarray(11, 43).equals(mint.toBuffer())) throw Error("PumpFun SharingConfig mint mismatch");
  return d[10] === 1 ? getCreatorVaultPda(getPumpFunFeeSharingConfigPda(mint)) : void 0;
}
var init_cached_pumpfun_config = __esm({
  "src/trading/cached_pumpfun_config.ts"() {
    "use strict";
    init_pumpfun_builder();
  }
});

// src/params/index.ts
import { PublicKey as PublicKey14 } from "@solana/web3.js";
function decodePumpFunBondingCurveData(data, bondingCurveAddr) {
  const discriminator = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
  if (data.length < 83 || data.length > 83 && data.length < 115 || !data.subarray(0, 8).equals(discriminator)) {
    throw new Error("Invalid PumpFun bonding curve account layout");
  }
  for (const index of [48, 81, 82]) {
    if (data[index] > 1) throw new Error("Invalid PumpFun bonding curve boolean");
  }
  let offset = 8;
  const virtualTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const virtualSolReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const realTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const realSolReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const tokenTotalSupply = data.readBigUInt64LE(offset);
  offset += 8;
  const complete = data.readUInt8(offset) === 1;
  offset += 1;
  const creator = new PublicKey14(data.subarray(offset, offset + 32));
  offset += 32;
  const isMayhemMode = data.readUInt8(offset) === 1;
  offset += 1;
  const isCashbackCoin = data.readUInt8(offset) === 1;
  const quoteMint = data.length >= 115 ? new PublicKey14(data.subarray(83, 115)) : WSOL_TOKEN_ACCOUNT;
  return {
    discriminator: 0,
    account: bondingCurveAddr,
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
    creator,
    isMayhemMode,
    isCashbackCoin,
    quoteMint
  };
}
var init_params = __esm({
  "src/params/index.ts"() {
    "use strict";
    init_constants();
  }
});

// src/trading/cached_damm_v2.ts
init_meteora_damm_v2_builder();
import { PublicKey as PublicKey3 } from "@solana/web3.js";

// src/instruction/token_mint_state.ts
var TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
var TOKEN2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
var lengths = /* @__PURE__ */ new Map([
  [1, 108],
  [3, 32],
  [4, 65],
  [6, 1],
  [10, 52],
  [12, 32],
  [14, 64],
  [16, 129],
  [18, 64],
  [20, 64],
  [21, 80],
  [22, 64],
  [23, 72],
  [25, 56],
  [26, 33]
]);
function tokenTransferFeeForEpoch(data, owner, epoch) {
  if (typeof epoch !== "bigint" || epoch < 0n || epoch >= 1n << 64n)
    throw new Error("Epoch outside u64");
  const d = Buffer.from(data), program = owner.toBase58();
  if (program !== TOKEN && program !== TOKEN2022)
    throw new Error("Unsupported mint token program");
  if (d.length < 82 || d[45] !== 1 || d.readUInt32LE(0) > 1 || d.readUInt32LE(46) > 1)
    throw new Error("Invalid or uninitialized cached mint");
  if (program === TOKEN) {
    if (d.length !== 82) throw new Error("Invalid classic mint size");
    return { basisPoints: 0, maximumFee: 0n };
  }
  if (d.length === 82) return { basisPoints: 0, maximumFee: 0n };
  if (d.length < 166 || d.length === 355 || d[165] !== 1 || d.subarray(82, 165).some((b) => b !== 0))
    throw new Error("Invalid Token2022 mint layout");
  const extensions = /* @__PURE__ */ new Map();
  let offset = 166;
  while (offset < d.length) {
    if (d[offset] === 0 && d.subarray(offset).every((b) => b === 0)) break;
    if (offset + 4 > d.length) throw new Error("Truncated mint extension");
    const type = d.readUInt16LE(offset), length = d.readUInt16LE(offset + 2);
    offset += 4;
    if (!type || extensions.has(type) || offset + length > d.length)
      throw new Error("Invalid/duplicate mint extension");
    if (type !== 19 && !lengths.has(type))
      throw new Error("Unsupported mint extension: " + type);
    if (type !== 19 && lengths.get(type) !== length)
      throw new Error("Invalid mint extension size");
    extensions.set(type, d.subarray(offset, offset + length));
    offset += length;
  }
  const state = extensions.get(6);
  if (state && state[0] !== 1)
    throw new Error("Mint defaults to frozen/uninitialized accounts");
  const pause = extensions.get(26);
  if (pause && pause[32] !== 0) throw new Error("Mint transfers are paused");
  const hook = extensions.get(14);
  if (hook && hook.subarray(32).some((b) => b !== 0))
    throw new Error("Active transfer hook requires extra accounts");
  const fees = extensions.get(1);
  if (!fees) return { basisPoints: 0, maximumFee: 0n };
  const start = epoch >= fees.readBigUInt64LE(90) ? 90 : 72;
  const basisPoints = fees.readUInt16LE(start + 16);
  if (basisPoints > 1e4) throw new Error("Invalid mint fee basis points");
  return { basisPoints, maximumFee: fees.readBigUInt64LE(start + 8) };
}

// src/trading/cached_damm_v2.ts
init_spl_token();
function cachedDammV2(snapshot, hint, context, unixTimestamp) {
  if (typeof unixTimestamp !== "bigint" || unixTimestamp < 0n || unixTimestamp >= 1n << 64n) throw Error("Invalid DAMM v2 timestamp");
  const data = Buffer.from(snapshot.get(hint.pool, context, METEORA_DAMM_V2_PROGRAM_ID).data);
  if (data.length < 1112 || !data.subarray(0, 8).equals(Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]))) throw Error("Invalid DAMM v2 pool discriminator or size");
  const pool = decodeMeteoraPool(data.subarray(8));
  hint.matches(pool.tokenAMint, pool.tokenBMint);
  if (pool.poolStatus !== 0 || pool.liquidity === 0n || pool.activationType > 1 || pool.sqrtPrice < pool.sqrtMinPrice || pool.sqrtPrice > pool.sqrtMaxPrice || pool.sqrtMinPrice === 0n || pool.sqrtPrice === 0n) throw Error("DAMM v2 pool is inactive or invalid");
  if ((pool.activationType === 0 ? context.slot : unixTimestamp) < pool.activationPoint) throw Error("DAMM v2 pool is not activated");
  if (pool.tokenAVault.equals(pool.tokenBVault)) throw Error("DAMM v2 vaults collide");
  const mints = [pool.tokenAMint, pool.tokenBMint].map((k) => snapshot.get(k, context));
  const flags = [pool.tokenAFlag, pool.tokenBFlag];
  const transferFees = mints.map((a, i) => {
    if (flags[i] > 1 || !a.owner.equals(flags[i] === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID)) throw Error("DAMM v2 mint program flag mismatch");
    return tokenTransferFeeForEpoch(a.data, a.owner, context.epoch);
  });
  const reserves2 = [pool.tokenAVault, pool.tokenBVault].map((k, i) => {
    const vault = Buffer.from(snapshot.get(k, context, mints[i].owner).data), mint = i === 0 ? pool.tokenAMint : pool.tokenBMint;
    if (vault.length < 165 || !vault.subarray(0, 32).equals(mint.toBuffer()) || !vault.subarray(32, 64).equals(METEORA_DAMM_V2_AUTHORITY.toBuffer()) || vault[108] !== 1) throw Error("Invalid DAMM v2 vault identity or state");
    return vault.readBigUInt64LE(64);
  });
  snapshot.assertUsable();
  return { pool, poolAddress: hint.pool, tokenAProgram: mints[0].owner, tokenBProgram: mints[1].owner, transferFees, reserves: reserves2 };
}

// src/trading/cached_pumpswap.ts
init_pumpswap();
import { PublicKey as PublicKey6 } from "@solana/web3.js";
init_calc();
init_calc();
init_spl_token();
init_pumpswap();
import { SystemProgram as SystemProgram4, TransactionInstruction as TransactionInstruction4 } from "@solana/web3.js";
var GLOBAL_DISC = Buffer.from([149, 8, 156, 202, 160, 252, 176, 217]);
var accountBuffer = (data) => Buffer.from(data.buffer, data.byteOffset, data.byteLength);
function cachedPumpSwap(snapshot, hint, ctx) {
  const d = accountBuffer(snapshot.get(hint.pool, ctx, PUMPSWAP_PROGRAM).data);
  if (d.length < 8 || !d.subarray(0, 8).equals(PUMPSWAP_POOL_DISCRIMINATOR)) throw new Error("Invalid PumpSwap pool discriminator");
  const pool = decodePoolPayload(d.subarray(8));
  if (!pool || d.readUInt8(243) > 1 || d.readUInt8(244) > 1) throw new Error("Invalid PumpSwap pool layout");
  hint.matches(pool.baseMint, pool.quoteMint);
  const index = Buffer.alloc(2);
  index.writeUInt16LE(pool.index);
  const [address, bump] = PublicKey6.findProgramAddressSync([Buffer.from("pool"), index, pool.creator.toBuffer(), pool.baseMint.toBuffer(), pool.quoteMint.toBuffer()], PUMPSWAP_PROGRAM);
  if (!address.equals(hint.pool) || bump !== pool.poolBump) throw new Error("PumpSwap pool PDA mismatch");
  if (pool.poolBaseTokenAccount.equals(pool.poolQuoteTokenAccount)) throw new Error("PumpSwap vaults collide");
  const global = accountBuffer(snapshot.get(PUMPSWAP_GLOBAL_ACCOUNT, ctx, PUMPSWAP_PROGRAM).data);
  if (global.length < 899 || !global.subarray(0, 8).equals(GLOBAL_DISC) || global.readUInt8(417) > 1 || global.readUInt8(642) > 1) throw new Error("Invalid PumpSwap global config");
  const feeData = accountBuffer(snapshot.get(PUMPSWAP_FEE_CONFIG, ctx, PUMPSWAP_FEE_PROGRAM).data);
  const [feeAddress, feeBump] = PublicKey6.findProgramAddressSync([Buffer.from("fee_config"), PUMPSWAP_PROGRAM.toBuffer()], PUMPSWAP_FEE_PROGRAM);
  if (!feeAddress.equals(PUMPSWAP_FEE_CONFIG) || feeData.length < 9 || feeData[8] !== feeBump) throw new Error("PumpSwap fee config PDA bump mismatch");
  const config = decodeFeeConfig(feeData);
  if (!config) throw new Error("Invalid PumpSwap fee config");
  for (const tiers of [config.feeTiers, config.stableFeeTiers]) for (let i = 1; i < tiers.length; i++) if (tiers[i - 1].marketCapLamportsThreshold >= tiers[i].marketCapLamportsThreshold) throw new Error("PumpSwap fee tiers are not strictly ordered");
  const mints = [pool.baseMint, pool.quoteMint].map((k) => snapshot.get(k, ctx));
  const transferFees = mints.map((m) => tokenTransferFeeForEpoch(m.data, m.owner, ctx.epoch));
  const reserves2 = [pool.poolBaseTokenAccount, pool.poolQuoteTokenAccount].map((k, i) => {
    const v = accountBuffer(snapshot.get(k, ctx, mints[i].owner).data);
    if (v.length < 165 || !v.subarray(0, 32).equals([pool.baseMint, pool.quoteMint][i].toBuffer()) || !v.subarray(32, 64).equals(hint.pool.toBuffer()) || v[108] !== 1) throw new Error("Invalid PumpSwap vault identity or state");
    return v.readBigUInt64LE(64);
  });
  if (!reserves2[0] || !reserves2[1]) throw new Error("PumpSwap reserves are empty");
  const effectiveQuoteReserve = effectiveQuoteReserves(reserves2[1], pool.virtualQuoteReserves);
  const baseMintSupply = accountBuffer(mints[0].data).readBigUInt64LE(36);
  const fees = computePumpSwapFeeBasisPoints(config, pool.creator, pool.baseMint, baseMintSupply, reserves2[0], effectiveQuoteReserve);
  const keys = (start, n) => Array.from({ length: n }, (_, i) => new PublicKey6(global.subarray(start + i * 32, start + (i + 1) * 32)));
  snapshot.assertUsable();
  return {
    poolAddress: hint.pool,
    pool,
    baseReserve: reserves2[0],
    quoteReserve: reserves2[1],
    baseMintSupply,
    baseTokenProgram: mints[0].owner,
    quoteTokenProgram: mints[1].owner,
    baseTransferFee: transferFees[0],
    quoteTransferFee: transferFees[1],
    feeBasisPoints: { ...fees },
    disableFlags: global[56],
    protocolFeeRecipients: keys(57, 8),
    reservedFeeRecipients: keys(385, 1).concat(keys(418, 7)),
    buybackFeeRecipients: keys(643, 8),
    mayhemEnabled: global[417] === 1,
    cashbackEnabled: global[642] === 1
  };
}
function prepareCachedPumpSwap(snapshot, hint, ctx, payer, amount, slippageBps = 0) {
  if (typeof amount !== "bigint" || amount <= 0n || amount >= 1n << 64n || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 1e4 || payer.equals(PublicKey6.default)) throw new Error("Invalid PumpSwap preparation request");
  const state = cachedPumpSwap(snapshot, hint, ctx), p = state.pool;
  const quoteIn = hint.inputMint.equals(p.quoteMint);
  if (state.disableFlags & (quoteIn ? 8 : 16)) throw new Error("PumpSwap direction is disabled");
  if (p.isCashbackCoin) throw new Error("PumpSwap cashback quote requires a verified current fee context");
  for (const f of [state.baseTransferFee, state.quoteTransferFee]) if (f.basisPoints !== 0 && f.maximumFee !== 0n) throw new Error("PumpSwap transfer-fee quote semantics are not yet verified");
  const fees = { ...state.feeBasisPoints, coinCreatorFeeBasisPoints: p.coinCreator.equals(PublicKey6.default) ? 0n : state.feeBasisPoints.coinCreatorFeeBasisPoints };
  const amountOut = quoteIn ? buyQuoteInputInternalWithFees(amount, 0n, state.baseReserve, state.quoteReserve, p.virtualQuoteReserves, fees).base : sellBaseInputInternalWithFees(amount, 0n, state.baseReserve, state.quoteReserve, p.virtualQuoteReserves, fees).uiQuote;
  const minimumAmountOut = calculateWithSlippageSell(amountOut, BigInt(slippageBps));
  if (!minimumAmountOut) throw new Error("PumpSwap quote has zero protected output");
  const choose = (keys, label) => {
    const k = keys.find((k2) => !k2.equals(PublicKey6.default));
    if (!k) throw new Error("Missing current PumpSwap " + label + " recipient");
    return k;
  };
  const feeRecipient = choose(p.isMayhemMode ? state.reservedFeeRecipients : state.protocolFeeRecipients, "protocol");
  const buyback = choose(state.buybackFeeRecipients, "buyback");
  const writable = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
  const readonly = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
  const accounts = [writable(hint.pool), { pubkey: payer, isSigner: true, isWritable: true }, readonly(PUMPSWAP_GLOBAL_ACCOUNT), readonly(p.baseMint), readonly(p.quoteMint), writable(getAssociatedTokenAddress(payer, p.baseMint, state.baseTokenProgram)), writable(getAssociatedTokenAddress(payer, p.quoteMint, state.quoteTokenProgram)), writable(p.poolBaseTokenAccount), writable(p.poolQuoteTokenAccount), readonly(feeRecipient), writable(getAssociatedTokenAddress(feeRecipient, p.quoteMint, state.quoteTokenProgram)), readonly(state.baseTokenProgram), readonly(state.quoteTokenProgram), readonly(SystemProgram4.programId), readonly(ASSOCIATED_TOKEN_PROGRAM_ID), readonly(PUMPSWAP_EVENT_AUTHORITY), readonly(PUMPSWAP_PROGRAM), writable(getCoinCreatorVaultAta(p.coinCreator, p.quoteMint, state.quoteTokenProgram)), readonly(getCoinCreatorVaultAuthority(p.coinCreator))];
  if (quoteIn) accounts.push(writable(PUMPSWAP_GLOBAL_VOLUME_ACCUMULATOR), writable(getUserVolumeAccumulatorPDA(payer)));
  accounts.push(readonly(PUMPSWAP_FEE_CONFIG), readonly(PUMPSWAP_FEE_PROGRAM));
  if (!p.coinCreator.equals(PublicKey6.default)) accounts.push(readonly(getPoolV2PDA(p.baseMint)));
  accounts.push(readonly(buyback), writable(getAssociatedTokenAddress(buyback, p.quoteMint, state.quoteTokenProgram)));
  const data = Buffer.alloc(quoteIn ? 25 : 24);
  (quoteIn ? PUMPSWAP_BUY_EXACT_QUOTE_IN_DISCRIMINATOR : PUMPSWAP_SELL_DISCRIMINATOR).copy(data);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(minimumAmountOut, 16);
  const instruction2 = new TransactionInstruction4({ programId: PUMPSWAP_PROGRAM, keys: accounts, data });
  snapshot.assertUsable();
  return { state, quote: { amountIn: amount, amountOut, minimumAmountOut }, instruction: instruction2 };
}

// src/trading/cached_amm_v4.ts
init_constants();
init_spl_token();
import { PublicKey as PublicKey7, TransactionInstruction as TransactionInstruction5 } from "@solana/web3.js";
var CACHED_AMM_V4_PROGRAM = new PublicKey7(
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
);
var CACHED_AMM_V4_AUTHORITY = new PublicKey7(
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"
);
function unsigned2(n) {
  if (typeof n !== "bigint" || n < 0n || n >= 1n << 64n)
    throw Error("AMM v4 value must be u64");
  return n;
}
function cachedAmmV4(snapshot, hint, ctx, unixTimestamp) {
  unsigned2(unixTimestamp);
  const d = Buffer.from(
    snapshot.get(hint.pool, ctx, CACHED_AMM_V4_PROGRAM).data
  );
  if (d.length !== 752) throw Error("Invalid AMM v4 pool length");
  const num = (o) => d.readBigUInt64LE(o), key = (o) => new PublicKey7(d.subarray(o, o + 32)), status = num(0), nonce = num(8);
  if (![1n, 6n, 7n].includes(status) || status === 7n && unixTimestamp < num(224))
    throw Error("AMM v4 swap is disabled or not open");
  if (nonce > 255n || !PublicKey7.createProgramAddressSync(
    [Buffer.from("amm authority"), Buffer.from([Number(nonce)])],
    CACHED_AMM_V4_PROGRAM
  ).equals(CACHED_AMM_V4_AUTHORITY))
    throw Error("AMM v4 authority nonce mismatch");
  hint.matches(key(400), key(432));
  if (key(336).equals(key(368))) throw Error("AMM v4 vaults collide");
  const numerator = num(176), denominator = num(184);
  if (!denominator || numerator >= denominator)
    throw Error("Invalid AMM v4 swap fee");
  const reserves2 = [];
  for (const [vo, mo, po, deco] of [
    [336, 400, 192, 32],
    [368, 432, 200, 40]
  ]) {
    const mint = snapshot.get(key(mo), ctx, TOKEN_PROGRAM);
    tokenTransferFeeForEpoch(Buffer.from(mint.data), mint.owner, ctx.epoch);
    if (BigInt(mint.data[44]) !== num(deco))
      throw Error("AMM v4 mint decimals mismatch");
    const v = Buffer.from(snapshot.get(key(vo), ctx, TOKEN_PROGRAM).data);
    if (v.length !== 165 || !v.subarray(0, 32).equals(key(mo).toBuffer()) || !v.subarray(32, 64).equals(CACHED_AMM_V4_AUTHORITY.toBuffer()) || v[108] !== 1)
      throw Error("Invalid AMM v4 vault identity or state");
    const amount = v.readBigUInt64LE(64);
    if (num(po) >= amount) throw Error("AMM v4 PnL exhausts vault balance");
    reserves2.push(amount - num(po));
  }
  return {
    pool: hint.pool,
    coinMint: key(400),
    pcMint: key(432),
    coinVault: key(336),
    pcVault: key(368),
    coinReserve: reserves2[0],
    pcReserve: reserves2[1],
    swapFeeNumerator: numerator,
    swapFeeDenominator: denominator
  };
}
function quoteCachedAmmV4ExactIn(p, amount, coinIn, slippageBps = 0) {
  unsigned2(amount);
  if (!amount || typeof coinIn !== "boolean" || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 1e4)
    throw Error("Invalid AMM v4 quote request");
  const [i, o] = coinIn ? [p.coinReserve, p.pcReserve] : [p.pcReserve, p.coinReserve];
  if (!unsigned2(i) || !unsigned2(o) || !unsigned2(p.swapFeeDenominator) || unsigned2(p.swapFeeNumerator) >= p.swapFeeDenominator)
    throw Error("Invalid AMM v4 reserves or fee");
  const fee = (amount * p.swapFeeNumerator + p.swapFeeDenominator - 1n) / p.swapFeeDenominator, net = amount - fee, out = o * net / (i + net);
  return {
    amountIn: amount,
    amountOut: out,
    minimumAmountOut: out * BigInt(1e4 - slippageBps) / 10000n,
    swapFee: fee
  };
}
function prepareCachedAmmV4(snapshot, hint, ctx, unixTimestamp, payer, amount, slippageBps = 0) {
  const state = cachedAmmV4(snapshot, hint, ctx, unixTimestamp), quote = quoteCachedAmmV4ExactIn(
    state,
    amount,
    hint.inputMint.equals(state.coinMint),
    slippageBps
  );
  if (!quote.minimumAmountOut)
    throw Error("AMM v4 quote has zero protected output");
  const keys = [
    TOKEN_PROGRAM,
    state.pool,
    CACHED_AMM_V4_AUTHORITY,
    state.coinVault,
    state.pcVault,
    getAssociatedTokenAddressSync(hint.inputMint, payer, true, TOKEN_PROGRAM),
    getAssociatedTokenAddressSync(
      hint.outputMint,
      payer,
      true,
      TOKEN_PROGRAM
    ),
    payer
  ], data = Buffer.alloc(17);
  data[0] = 16;
  data.writeBigUInt64LE(quote.amountIn, 1);
  data.writeBigUInt64LE(quote.minimumAmountOut, 9);
  return {
    state,
    quote,
    instruction: new TransactionInstruction5({
      programId: CACHED_AMM_V4_PROGRAM,
      data,
      keys: keys.map((pubkey, i) => ({
        pubkey,
        isSigner: i === 7,
        isWritable: [1, 3, 4, 5, 6].includes(i)
      }))
    })
  };
}

// src/instruction/cached_cpmm.ts
init_spl_token();
import { PublicKey as PublicKey9, TransactionInstruction as TransactionInstruction7 } from "@solana/web3.js";

// src/instruction/stonkfun.ts
init_spl_token();
import {
  PublicKey as PublicKey8,
  TransactionInstruction as TransactionInstruction6,
  SystemProgram as SystemProgram5
} from "@solana/web3.js";
var STONKFUN_PROGRAM = new PublicKey8(
  "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
);
var AUTHORITY = new PublicKey8("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh");
var EVENT_AUTHORITY = new PublicKey8(
  "2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr"
);
var CONFIGS = /* @__PURE__ */ new Set([
  "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7",
  "6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt"
]);
var U642 = (1n << 64n) - 1n;
var U1282 = (1n << 128n) - 1n;
function unsigned3(value, max3 = U642) {
  if (typeof value !== "bigint" || value < 0n || value > max3)
    throw new Error("Amount outside unsigned integer range");
  return value;
}
var ceil2 = (n, d) => (n + d - 1n) / d;
function calculateTokenTransferFee(amount, fee, inverse = false) {
  unsigned3(amount);
  unsigned3(fee.maximumFee);
  if (typeof inverse !== "boolean")
    throw new Error("Boolean transfer fee direction required");
  if (!Number.isInteger(fee.basisPoints) || fee.basisPoints < 0 || fee.basisPoints > 1e4)
    throw new Error("Invalid token fee basis points");
  if (!fee.basisPoints || !amount) return 0n;
  const rate = BigInt(fee.basisPoints);
  const value = inverse ? rate === 10000n ? fee.maximumFee : ceil2(amount * rate, 10000n - rate) : ceil2(amount * rate, 10000n);
  return value < fee.maximumFee ? value : fee.maximumFee;
}
function reserves(p, share, bps) {
  if (p.curveType !== 0) throw new Error("Unsupported LaunchLab curve type");
  for (const n of [
    p.virtualBase,
    p.virtualQuote,
    p.realBase,
    p.realQuote,
    p.totalBaseSell
  ])
    unsigned3(n, U1282);
  if (p.realBase > p.virtualBase)
    throw new Error("LaunchLab reserve underflow");
  const base = p.virtualBase - p.realBase, quote = unsigned3(p.virtualQuote + p.realQuote, U1282);
  const rate = unsigned3(p.tradeFeeRate) + unsigned3(p.platformFeeRate) + unsigned3(p.creatorFeeRate) + unsigned3(share);
  if (rate > 1000000n) throw new Error("LaunchLab fee exceeds denominator");
  if (!Number.isInteger(bps) || bps < 0 || bps > 9999)
    throw new Error("Slippage must be 0..9999");
  return { base, quote, rate, bps: BigInt(bps) };
}
function quoteLaunchLabExactIn(p, amount, buy, slippageBps = 0, shareFeeRate = 0n) {
  unsigned3(amount);
  if (!amount) throw new Error("Amount cannot be zero");
  if (typeof buy !== "boolean")
    throw new Error("Boolean trade direction required");
  const { base, quote, rate, bps } = reserves(p, shareFeeRate, slippageBps);
  let actual = amount, received;
  if (buy) {
    const vault = amount - calculateTokenTransferFee(amount, p.quoteTransferFee), net = vault - ceil2(vault * rate, 1000000n);
    const denominator = unsigned3(quote + net, U1282);
    if (!denominator) throw new Error("Empty curve reserves");
    let out = unsigned3(net * base, U1282) / denominator;
    if (p.totalBaseSell) {
      if (p.realBase > p.totalBaseSell)
        throw new Error("LaunchLab sold amount exceeds cap");
      const remaining = p.totalBaseSell - p.realBase;
      if (out > remaining) {
        const after = base - remaining;
        if (after <= 0n || rate === 1000000n)
          throw new Error("LaunchLab graduation exhausts reserves");
        const required = ceil2(unsigned3(quote * remaining, U1282), after), requiredVault = unsigned3(
          ceil2(unsigned3(required * 1000000n, U1282), 1000000n - rate)
        );
        actual = unsigned3(
          requiredVault + calculateTokenTransferFee(requiredVault, p.quoteTransferFee, true)
        );
        if (actual > amount) actual = amount;
        out = remaining;
      }
    }
    unsigned3(out);
    received = out - calculateTokenTransferFee(out, p.baseTransferFee);
  } else {
    const net = amount - calculateTokenTransferFee(amount, p.baseTransferFee), denominator = unsigned3(base + net, U1282);
    if (!denominator) throw new Error("Empty curve reserves");
    const gross = unsigned3(net * quote, U1282) / denominator, vault = unsigned3(gross - ceil2(gross * rate, 1000000n));
    received = vault - calculateTokenTransferFee(vault, p.quoteTransferFee);
  }
  return {
    amountIn: actual,
    minimumAmountOut: unsigned3(received - received * bps / 10000n)
  };
}
function buildStonkFunCurveExactIn(p, payer, amountIn, minimumAmountOut, buy, shareFeeRate = 0n) {
  if (!CONFIGS.has(p.platformConfig.toBase58()))
    throw new Error("Unverified StonkFun platform config");
  return buildLaunchLabCurveExactIn(
    p,
    payer,
    amountIn,
    minimumAmountOut,
    buy,
    shareFeeRate
  );
}
function buildLaunchLabCurveExactIn(p, payer, amountIn, minimumAmountOut, buy, shareFeeRate = 0n) {
  unsigned3(amountIn);
  unsigned3(minimumAmountOut);
  unsigned3(shareFeeRate);
  if (!amountIn) throw new Error("Amount cannot be zero");
  if (typeof buy !== "boolean")
    throw new Error("Boolean trade direction required");
  if (p.baseMint.equals(p.quoteMint))
    throw new Error("Identical base and quote");
  for (const key of Object.values(p))
    if (key.equals(PublicKey8.default))
      throw new Error("Missing StonkFun account");
  const userBase = getAssociatedTokenAddressSync(
    p.baseMint,
    payer,
    true,
    p.baseTokenProgram
  ), userQuote = getAssociatedTokenAddressSync(
    p.quoteMint,
    payer,
    true,
    p.quoteTokenProgram
  );
  const keys = [
    payer,
    AUTHORITY,
    p.globalConfig,
    p.platformConfig,
    p.pool,
    userBase,
    userQuote,
    p.baseVault,
    p.quoteVault,
    p.baseMint,
    p.quoteMint,
    p.baseTokenProgram,
    p.quoteTokenProgram,
    EVENT_AUTHORITY,
    STONKFUN_PROGRAM,
    SystemProgram5.programId,
    p.platformAssociatedAccount,
    p.creatorAssociatedAccount
  ];
  const data = Buffer.alloc(32);
  Buffer.from(
    buy ? [250, 234, 13, 123, 213, 156, 19, 236] : [149, 39, 222, 155, 211, 124, 152, 26]
  ).copy(data);
  data.writeBigUInt64LE(amountIn, 8);
  data.writeBigUInt64LE(minimumAmountOut, 16);
  data.writeBigUInt64LE(shareFeeRate, 24);
  return new TransactionInstruction6({
    programId: STONKFUN_PROGRAM,
    data,
    keys: keys.map((pubkey, i) => ({
      pubkey,
      isSigner: i === 0,
      isWritable: [0, 4, 5, 6, 7, 8, 16, 17].includes(i)
    }))
  });
}
function decodeStonkFunCurve(pool, global, platform, baseTokenProgram, quoteTokenProgram, baseTransferFee, quoteTransferFee) {
  if (!CONFIGS.has(platform.pubkey.toBase58()))
    throw new Error("LaunchLab config identity mismatch");
  return decodeLaunchLabCurve(
    pool,
    global,
    platform,
    baseTokenProgram,
    quoteTokenProgram,
    baseTransferFee,
    quoteTransferFee
  );
}
function decodeLaunchLabCurve(pool, global, platform, baseTokenProgram, quoteTokenProgram, baseTransferFee, quoteTransferFee) {
  for (const a of [pool, global, platform])
    if (!a.owner.equals(STONKFUN_PROGRAM))
      throw new Error("Unexpected LaunchLab account owner");
  const d = Buffer.from(pool.data), g = Buffer.from(global.data), p = Buffer.from(platform.data);
  if (d.length < 429 || d.subarray(0, 8).toString("hex") !== "f7ede3f5d7c3de46" || g.length < 35 || g.subarray(0, 8).toString("hex") !== "95089ccaa0fcb0d9" || p.length < 728 || p.subarray(0, 8).toString("hex") !== "a04e8000f853e6a0")
    throw new Error("Invalid LaunchLab state bytes");
  const key = (o) => new PublicKey8(d.subarray(o, o + 32));
  if (!key(141).equals(global.pubkey) || !key(173).equals(platform.pubkey))
    throw new Error("LaunchLab config identity mismatch");
  if (d[17] !== 0) throw new Error("LaunchLab curve is not trading");
  const quote = key(237), creator = key(333), associated = (k) => PublicKey8.findProgramAddressSync(
    [k.toBuffer(), quote.toBuffer()],
    STONKFUN_PROGRAM
  )[0];
  return {
    accounts: {
      pool: pool.pubkey,
      baseMint: key(205),
      quoteMint: quote,
      baseVault: key(269),
      quoteVault: key(301),
      globalConfig: global.pubkey,
      platformConfig: platform.pubkey,
      baseTokenProgram,
      quoteTokenProgram,
      platformAssociatedAccount: associated(platform.pubkey),
      creatorAssociatedAccount: associated(creator)
    },
    state: {
      virtualBase: d.readBigUInt64LE(37),
      virtualQuote: d.readBigUInt64LE(45),
      realBase: d.readBigUInt64LE(53),
      realQuote: d.readBigUInt64LE(61),
      totalBaseSell: d.readBigUInt64LE(29),
      curveType: g[16],
      tradeFeeRate: g.readBigUInt64LE(27),
      platformFeeRate: p.readBigUInt64LE(104),
      creatorFeeRate: p.readBigUInt64LE(720),
      baseTransferFee,
      quoteTransferFee
    }
  };
}

// src/instruction/cached_cpmm.ts
var CACHED_CPMM_PROGRAM = new PublicKey9(
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
);
var CACHED_CPMM_AUTHORITY = new PublicKey9(
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL"
);
function unsigned4(n) {
  if (typeof n !== "bigint" || n < 0n || n >= 1n << 64n)
    throw new Error("Value outside u64");
  return n;
}
var ceil3 = (n, d) => (n + d - 1n) / d;
function quoteCachedCpmmExactIn(p, amount, baseIn, slippageBps = 0) {
  unsigned4(amount);
  if (!amount || typeof baseIn !== "boolean")
    throw new Error("Positive amount and boolean direction required");
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 9999)
    throw new Error("Slippage must be 0..9999");
  if (typeof p.enableCreatorFee !== "boolean")
    throw new Error("Invalid CPMM fee configuration");
  const rawCreatorRate = unsigned4(p.creatorFeeRate), creatorRate = p.enableCreatorFee ? rawCreatorRate : 0n, tradeRate = unsigned4(p.tradeFeeRate);
  if (tradeRate + creatorRate >= 1000000n || unsigned4(p.protocolFeeRate) + unsigned4(p.fundFeeRate) > 1000000n || ![0, 1, 2].includes(p.creatorFeeOn))
    throw new Error("Invalid CPMM fee configuration");
  const [i, o, inputFee, outputFee] = baseIn ? [p.baseReserve, p.quoteReserve, p.baseTransferFee, p.quoteTransferFee] : [p.quoteReserve, p.baseReserve, p.quoteTransferFee, p.baseTransferFee];
  if (!unsigned4(i) || !unsigned4(o)) throw new Error("Empty CPMM reserves");
  const net = amount - calculateTokenTransferFee(amount, inputFee), onInput = p.creatorFeeOn === 0 || p.creatorFeeOn === 1 && baseIn || p.creatorFeeOn === 2 && !baseIn;
  const totalRate = tradeRate + (onInput ? creatorRate : 0n), fee = ceil3(net * totalRate, 1000000n);
  let creator = onInput && totalRate ? fee * creatorRate / totalRate : 0n;
  const trade = fee - creator, swapped = o * (net - fee) / (i + net - fee);
  if (!onInput) creator = ceil3(swapped * creatorRate, 1000000n);
  const gross = swapped - (onInput ? 0n : creator), received = gross - calculateTokenTransferFee(gross, outputFee);
  return {
    amountIn: amount,
    amountOut: unsigned4(received),
    minimumAmountOut: received * BigInt(1e4 - slippageBps) / 10000n,
    tradeFee: trade,
    creatorFee: creator
  };
}
function buildCachedCpmmExactIn(p, payer, amount, minimumAmountOut, baseIn) {
  unsigned4(amount);
  unsigned4(minimumAmountOut);
  if (!amount || typeof baseIn !== "boolean")
    throw new Error("Positive amount and boolean direction required");
  const [im, om, iv, ov, ip, op] = baseIn ? [
    p.baseMint,
    p.quoteMint,
    p.baseVault,
    p.quoteVault,
    p.baseTokenProgram,
    p.quoteTokenProgram
  ] : [
    p.quoteMint,
    p.baseMint,
    p.quoteVault,
    p.baseVault,
    p.quoteTokenProgram,
    p.baseTokenProgram
  ];
  const keys = [
    payer,
    CACHED_CPMM_AUTHORITY,
    p.config,
    p.pool,
    getAssociatedTokenAddressSync(im, payer, true, ip),
    getAssociatedTokenAddressSync(om, payer, true, op),
    iv,
    ov,
    ip,
    op,
    im,
    om,
    p.observation
  ];
  const data = Buffer.alloc(24);
  Buffer.from([143, 190, 90, 218, 196, 30, 51, 222]).copy(data);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(minimumAmountOut, 16);
  return new TransactionInstruction7({
    programId: CACHED_CPMM_PROGRAM,
    data,
    keys: keys.map((pubkey, i) => ({
      pubkey,
      isSigner: i === 0,
      isWritable: [0, 3, 4, 5, 6, 7, 12].includes(i)
    }))
  });
}

// src/trading/subscription_cache.ts
import { PublicKey as PublicKey18 } from "@solana/web3.js";

// src/trading/cached_clmm.ts
init_spl_token();
import { PublicKey as PublicKey11 } from "@solana/web3.js";

// src/calc/clmm.ts
var CLMM_MIN_TICK = -443636;
var CLMM_MAX_TICK = 443636;
var CLMM_MIN_SQRT_PRICE = 4295048016n;
var CLMM_MAX_SQRT_PRICE = 79226673521066979257578248091n;
var Q642 = 1n << 64n;
var U643 = Q642 - 1n;
var U1283 = (1n << 128n) - 1n;
var FACTORS = [
  0xfffcb933bd6fb800n,
  0xfff97272373d4000n,
  0xfff2e50f5f657000n,
  0xffe5caca7e10f000n,
  0xffcb9843d60f7000n,
  0xff973b41fa98e800n,
  0xff2ea16466c9b000n,
  0xfe5dee046a9a3800n,
  0xfcbe86c7900bb000n,
  0xf987a7253ac65800n,
  0xf3392b0822bb6000n,
  0xe7159475a2caf000n,
  0xd097f3bdfd2f2000n,
  0xa9f746462d9f8000n,
  0x70d869a156f31c00n,
  0x31be135f97ed3200n,
  0x9aa508b5b85a500n,
  0x5d6af8dedc582cn,
  0x2216e584f5fan
];
function uint2(v, maximum = U643) {
  if (typeof v !== "bigint" || v < 0n || v > maximum)
    throw Error("CLMM unsigned integer outside range");
  return v;
}
var ceil4 = (n, d) => (n + d - 1n) / d;
var min = (a, b) => a < b ? a : b;
var max = (a, b) => a > b ? a : b;
function clmmSqrtPriceAtTick(tick) {
  if (!Number.isInteger(tick) || tick < CLMM_MIN_TICK || tick > CLMM_MAX_TICK)
    throw Error("CLMM tick outside range");
  let ratio = Q642;
  for (let b = 0; b < FACTORS.length; b++)
    if (Math.abs(tick) & 1 << b) ratio = ratio * FACTORS[b] >> 64n;
  return tick > 0 ? U1283 / ratio : ratio;
}
function clmmTickAtSqrtPrice(price) {
  uint2(price, U1283);
  if (price < CLMM_MIN_SQRT_PRICE || price >= CLMM_MAX_SQRT_PRICE)
    throw Error("CLMM price outside range");
  let lo = CLMM_MIN_TICK, hi = CLMM_MAX_TICK;
  while (lo < hi) {
    const m = Math.floor((lo + hi + 1) / 2);
    if (clmmSqrtPriceAtTick(m) <= price) lo = m;
    else hi = m - 1;
  }
  return lo;
}
function delta(a, b, l, token0, up) {
  const low = min(a, b), high = max(a, b);
  if (low <= 0n) throw Error("CLMM zero sqrt price");
  const n = l * (high - low) * (token0 ? Q642 : 1n), d = token0 ? high * low : Q642;
  return up ? ceil4(n, d) : n / d;
}
function clmmSwapStep(current, target, liquidity, remaining, feeRate, down) {
  uint2(current, U1283);
  uint2(target, U1283);
  uint2(liquidity, U1283);
  uint2(remaining);
  if (!Number.isInteger(feeRate) || feeRate < 0 || feeRate >= 1e6 || typeof down !== "boolean" || current <= 0n || target <= 0n || (down ? target > current : target < current))
    throw Error("Invalid CLMM step");
  const rate = BigInt(feeRate), net = remaining * (1000000n - rate) / 1000000n, needed = delta(current, target, liquidity, down, true);
  let next;
  if (needed <= net) next = target;
  else if (liquidity === 0n) throw Error("CLMM zero liquidity");
  else
    next = down ? ceil4((liquidity << 64n) * current, (liquidity << 64n) + net * current) : current + (net << 64n) / liquidity;
  const amountIn = next === target ? needed : delta(current, next, liquidity, down, true), amountOut = delta(current, next, liquidity, !down, false), fee = next !== target ? remaining - amountIn : ceil4(amountIn * rate, 1000000n - rate);
  return {
    sqrtPrice: uint2(next, U1283),
    amountIn: uint2(amountIn),
    amountOut: uint2(amountOut),
    fee: uint2(fee)
  };
}
function clmmSwapExactIn(pool, ticks, amount, limit, feeOn, dynamic, timestamp, down) {
  uint2(amount);
  uint2(timestamp);
  uint2(pool.liquidity, U1283);
  uint2(pool.sqrtPrice, U1283);
  uint2(limit, U1283);
  if (pool.sqrtPrice < CLMM_MIN_SQRT_PRICE || pool.sqrtPrice > CLMM_MAX_SQRT_PRICE || !Number.isInteger(pool.tickCurrent) || pool.tickCurrent < CLMM_MIN_TICK || pool.tickCurrent > CLMM_MAX_TICK || !Number.isInteger(pool.tickSpacing) || pool.tickSpacing < 1 || pool.tickSpacing > 65535 || !Number.isInteger(pool.feeRate) || pool.feeRate < 0 || pool.feeRate >= 1e6 || ![0, 1, 2].includes(feeOn))
    throw Error("Invalid CLMM pool");
  if (typeof down !== "boolean" || limit < CLMM_MIN_SQRT_PRICE || limit > CLMM_MAX_SQRT_PRICE || (down ? limit >= pool.sqrtPrice : limit <= pool.sqrtPrice))
    throw Error("Invalid CLMM limit");
  if (!(dynamic instanceof Uint8Array) || dynamic.length !== 80)
    throw Error("Invalid CLMM dynamic bytes");
  const d = Buffer.from(dynamic);
  const number = (o, n, signed = false) => n === 2 ? d.readUInt16LE(o) : signed ? d.readInt32LE(o) : d.readUInt32LE(o);
  const inputFee = feeOn === 0 || feeOn === 1 && down || feeOn === 2 && !down, enabled = d.some((v) => v !== 0);
  let group = Math.floor(pool.tickCurrent / pool.tickSpacing), reference = number(14, 4, true), volatilityReference = number(18, 4), volatility = number(22, 4);
  const maximum = number(10, 4), control = number(6, 4);
  if (enabled) {
    if (number(0, 2) <= 0 || number(2, 2) <= number(0, 2) || number(4, 2) < 1 || number(4, 2) >= 1e4 || control < 1 || control >= 1e5 || maximum * pool.tickSpacing > 4294967295)
      throw Error("Invalid CLMM dynamic fee params");
    const last = d.readBigUInt64LE(26), elapsed = timestamp > last ? timestamp - last : 0n;
    if (elapsed >= BigInt(number(0, 2))) {
      reference = group;
      volatilityReference = elapsed < BigInt(number(2, 2)) ? Math.floor(volatility * number(4, 2) / 1e4) : 0;
    }
  }
  if (new Set(ticks.map((t) => t.tick)).size !== ticks.length)
    throw Error("Duplicate CLMM tick");
  for (const t of ticks) {
    if (!Number.isInteger(t.tick) || t.tick < CLMM_MIN_TICK || t.tick > CLMM_MAX_TICK || t.tick % pool.tickSpacing || typeof t.liquidityNet !== "bigint" || t.liquidityNet < -(1n << 127n) || t.liquidityNet >= 1n << 127n)
      throw Error("Invalid CLMM tick");
    uint2(t.liquidityGross, U1283);
  }
  const orders = ticks.map((t) => uint2(uint2(t.orders) + uint2(t.partialOrders)));
  let current = pool.sqrtPrice, tick = pool.tickCurrent, liquidity = pool.liquidity, remaining = amount, output = 0n;
  const result = () => ({
    consumed: amount - remaining,
    amountOut: output,
    sqrtPrice: current,
    tickCurrent: tick,
    liquidity
  });
  for (let iter = 0; iter < 8192; iter++) {
    if (remaining === 0n || current === limit) return result();
    let index;
    for (let i = 0; i < ticks.length; i++) {
      const t = ticks[i];
      if ((t.liquidityGross > 0n || orders[i] > 0n) && (down ? t.tick <= tick : t.tick > tick) && (index === void 0 || (down ? t.tick > ticks[index].tick : t.tick < ticks[index].tick)))
        index = i;
    }
    const nextTick = index === void 0 ? down ? CLMM_MIN_TICK : CLMM_MAX_TICK : ticks[index].tick, nextPrice = clmmSqrtPriceAtTick(nextTick), target = down ? max(nextPrice, limit) : min(nextPrice, limit);
    let fee = pool.feeRate, skipped = true, bound = target;
    if (enabled) {
      volatility = Math.min(
        volatilityReference + Math.abs(reference - group) * 1e4,
        maximum
      );
      const crossed = BigInt(volatility) * BigInt(pool.tickSpacing);
      fee = Number(
        min(
          BigInt(fee) + ceil4(BigInt(control) * crossed * crossed, 10000000000000n),
          100000n
        )
      );
      skipped = liquidity === 0n || volatility === maximum;
      if (!skipped) {
        const boundary = Math.max(
          CLMM_MIN_TICK,
          Math.min(
            CLMM_MAX_TICK,
            (down ? group : group + 1) * pool.tickSpacing
          )
        ), price = clmmSqrtPriceAtTick(boundary);
        bound = down ? max(target, price) : min(target, price);
      }
    }
    const old = current;
    if (current !== bound) {
      const step = clmmSwapStep(
        current,
        bound,
        liquidity,
        remaining,
        inputFee ? fee : 0,
        down
      );
      remaining = uint2(remaining - step.amountIn - (inputFee ? step.fee : 0n));
      output = uint2(
        output + step.amountOut - (inputFee ? 0n : ceil4(step.amountOut * BigInt(fee), 1000000n))
      );
      current = step.sqrtPrice;
    }
    if (current === nextPrice) {
      if (index === void 0) break;
      const t = ticks[index];
      if (orders[index] > 0n && remaining > 0n) {
        const square = current * current, price = (square >> 64n) + (!down && (square & Q642 - 1n) !== 0n ? 1n : 0n);
        if (price === 0n) throw Error("CLMM zero order price");
        let feeAmount = inputFee ? ceil4(remaining * BigInt(fee), 1000000n) : 0n;
        const available = remaining - feeAmount, matched = down ? available * price / Q642 : available * Q642 / price, gross = min(matched, orders[index]);
        let consumed;
        if (matched > orders[index]) {
          consumed = uint2(
            down ? ceil4(gross * Q642, price) : ceil4(gross * price, Q642)
          );
          feeAmount = inputFee ? ceil4(consumed * BigInt(fee), 1000000n - BigInt(fee)) : 0n;
        } else consumed = available;
        remaining = uint2(remaining - uint2(consumed + feeAmount));
        orders[index] = orders[index] - gross;
        output = uint2(
          output + gross - (inputFee ? 0n : ceil4(gross * BigInt(fee), 1000000n))
        );
      }
      if (t.liquidityGross > 0n && orders[index] === 0n)
        liquidity = uint2(
          liquidity + (down ? -t.liquidityNet : t.liquidityNet),
          U1283
        );
      tick = down && orders[index] === 0n || !down && orders[index] > 0n ? nextTick - 1 : nextTick;
    } else if (current !== old) tick = clmmTickAtSqrtPrice(current);
    if (enabled) {
      if (skipped) {
        const boundaryTick = current === nextPrice ? nextTick : tick;
        group = Math.floor(boundaryTick / pool.tickSpacing);
        if (!down && boundaryTick % pool.tickSpacing === 0) group--;
      }
      group += down ? -1 : 1;
    }
  }
  if (remaining > 0n && current !== limit)
    throw Error("CLMM quote iteration budget exhausted");
  return result();
}

// src/instruction/native_hops.ts
import { PublicKey as PublicKey10, TransactionInstruction as TransactionInstruction8 } from "@solana/web3.js";
var MEMO = new PublicKey10("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
var CLMM = new PublicKey10("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
var WHIRLPOOL = new PublicKey10("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
var DLMM = new PublicKey10("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
var DLMM_EVENT = new PublicKey10(
  "D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVniYD6"
);
function dataV2(args, length) {
  for (const n of [args.amount, args.other_amount_threshold])
    if (typeof n !== "bigint" || n < 0n || n >= 1n << 64n)
      throw new Error("Swap amount outside u64");
  if (typeof args.sqrt_price_limit !== "bigint" || args.sqrt_price_limit < 0n || args.sqrt_price_limit >= 1n << 128n)
    throw new Error("Sqrt price outside u128");
  if (typeof args.amount_specified_is_input !== "boolean")
    throw Error("Swap mode must be boolean");
  const d = Buffer.alloc(length);
  Buffer.from([43, 4, 237, 11, 26, 201, 30, 98]).copy(d);
  d.writeBigUInt64LE(args.amount, 8);
  d.writeBigUInt64LE(args.other_amount_threshold, 16);
  d.writeBigUInt64LE(args.sqrt_price_limit & (1n << 64n) - 1n, 24);
  d.writeBigUInt64LE(args.sqrt_price_limit >> 64n, 32);
  d[40] = Number(args.amount_specified_is_input);
  return d;
}
function instruction(program, data, keys, signer, writable) {
  return new TransactionInstruction8({
    programId: program,
    data,
    keys: keys.map((pubkey, i) => ({
      pubkey,
      isSigner: i === signer,
      isWritable: writable(i)
    }))
  });
}
function buildRaydiumClmmSwapV2(a, args) {
  const pda = PublicKey10.findProgramAddressSync(
    [Buffer.from("pool_tick_array_bitmap_extension"), a.pool_state.toBuffer()],
    CLMM
  )[0];
  if (a.tick_array_bitmap_extension && !a.tick_array_bitmap_extension.equals(pda))
    throw Error("CLMM bitmap identity mismatch");
  const ticks = a.tick_arrays.filter((k) => !k.equals(pda));
  const bitmap = a.tick_array_bitmap_extension?.equals(pda) || a.tick_arrays.some((k) => k.equals(pda));
  if (!ticks.length) throw new Error("CLMM requires at least one tick array");
  const keys = [
    a.payer,
    a.amm_config,
    a.pool_state,
    a.input_token_account,
    a.output_token_account,
    a.input_vault,
    a.output_vault,
    a.observation_state,
    a.token_program,
    a.token_program_2022,
    MEMO,
    a.input_vault_mint,
    a.output_vault_mint,
    ...bitmap ? [pda] : [],
    ...ticks
  ];
  return instruction(
    CLMM,
    dataV2(args, 41),
    keys,
    0,
    (i) => i >= 2 && i <= 7 || i >= 13
  );
}
function buildWhirlpoolSwapV2(a, args) {
  if (typeof args.a_to_b !== "boolean")
    throw Error("Swap direction must be boolean");
  if (a.tick_arrays.length < 3 || a.tick_arrays.length > 6)
    throw new Error("Whirlpool requires 3..6 tick arrays");
  const oracle = PublicKey10.findProgramAddressSync(
    [Buffer.from("oracle"), a.whirlpool.toBuffer()],
    WHIRLPOOL
  )[0];
  const keys = [
    a.token_program_a,
    a.token_program_b,
    MEMO,
    a.token_authority,
    a.whirlpool,
    a.mint_a,
    a.mint_b,
    a.owner_a,
    a.vault_a,
    a.owner_b,
    a.vault_b,
    ...a.tick_arrays.slice(0, 3),
    oracle,
    ...a.tick_arrays.slice(3)
  ];
  const limit = args.sqrt_price_limit || (args.a_to_b ? 4295048016n : 79226673515401279992447579055n), d = dataV2(
    { ...args, sqrt_price_limit: limit },
    a.tick_arrays.length > 3 ? 49 : 43
  );
  d[41] = Number(args.a_to_b);
  if (a.tick_arrays.length > 3) {
    d[42] = 1;
    d.writeUInt32LE(1, 43);
    d[47] = 6;
    d[48] = a.tick_arrays.length - 3;
  }
  return instruction(WHIRLPOOL, d, keys, 3, (i) => i === 4 || i >= 7);
}
function buildMeteoraDlmmSwap2(a, amountIn, minOut) {
  if (!a.bin_arrays.length)
    throw new Error("DLMM requires at least one bin array");
  for (const n of [amountIn, minOut])
    if (typeof n !== "bigint" || n < 0n || n >= 1n << 64n)
      throw new Error("Swap amount outside u64");
  const keys = [
    a.lb_pair,
    a.bitmap_extension ?? DLMM,
    a.reserve_x,
    a.reserve_y,
    a.user_token_in,
    a.user_token_out,
    a.token_x_mint,
    a.token_y_mint,
    a.oracle,
    DLMM,
    a.user,
    a.token_x_program,
    a.token_y_program,
    MEMO,
    DLMM_EVENT,
    DLMM,
    ...a.bin_arrays
  ];
  const d = Buffer.alloc(28);
  Buffer.from([65, 75, 63, 76, 235, 91, 91, 136]).copy(d);
  d.writeBigUInt64LE(amountIn, 8);
  d.writeBigUInt64LE(minOut, 16);
  return instruction(
    DLMM,
    d,
    keys,
    10,
    (i) => i === 0 || i === 1 && a.bitmap_extension !== void 0 || i >= 2 && i <= 5 || i === 8 || i >= 16
  );
}

// src/trading/cached_clmm.ts
var TOKEN_PROGRAM_ID2 = new PublicKey11(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
var TOKEN_2022_PROGRAM_ID2 = new PublicKey11(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
var CACHED_CLMM_PROGRAM = new PublicKey11(
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
);
function prepareCachedClmm(snapshot, hint, ctx, unixTimestamp, payer, amount, slippageBps = 0, maximumArrays = 8) {
  if (typeof amount !== "bigint" || amount <= 0n || amount >= 1n << 64n || typeof unixTimestamp !== "bigint" || unixTimestamp < 0n || unixTimestamp >= 1n << 64n || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 1e4 || !Number.isInteger(maximumArrays) || maximumArrays < 1 || maximumArrays > 32)
    throw Error("Invalid cached CLMM request");
  const d = Buffer.from(snapshot.get(hint.pool, ctx, CACHED_CLMM_PROGRAM).data);
  if (d.length < 1544 || d.subarray(0, 8).toString("hex") !== "f7ede3f5d7c3de46" || d[389] & 16)
    throw Error("Invalid or disabled CLMM pool");
  const key = (o) => new PublicKey11(d.subarray(o, o + 32)), wide3 = (b, o) => b.readBigUInt64LE(o) + (b.readBigUInt64LE(o + 8) << 64n);
  hint.matches(key(73), key(105));
  if (unixTimestamp <= d.readBigUInt64LE(1080))
    throw Error("CLMM pool is not open");
  const config = Buffer.from(
    snapshot.get(key(9), ctx, CACHED_CLMM_PROGRAM).data
  ), spacing = d.readUInt16LE(235);
  if (config.length < 55 || config.subarray(0, 8).toString("hex") !== "daf42168cbcb2b6f" || !spacing || config.readUInt16LE(51) !== spacing)
    throw Error("Invalid CLMM config");
  const mints = [snapshot.get(key(73), ctx), snapshot.get(key(105), ctx)], fees = mints.map(
    (a) => tokenTransferFeeForEpoch(a.data, a.owner, ctx.epoch)
  ), down = hint.inputMint.equals(key(73)), fi = fees[down ? 0 : 1], fo = fees[down ? 1 : 0];
  const netInput = amount - calculateTokenTransferFee(amount, fi);
  if (!netInput) throw Error("CLMM input is zero after transfer fee");
  const pool = {
    sqrtPrice: wide3(d, 253),
    liquidity: wide3(d, 237),
    tickCurrent: d.readInt32LE(269),
    tickSpacing: spacing,
    feeRate: config.readUInt32LE(47)
  }, step = 60 * spacing, start = Math.floor(pool.tickCurrent / step) * step;
  const ticks = [], arrays = [];
  let bitmap;
  let extension;
  const bit = (b, o, i) => Boolean(b[o + Math.floor(i / 8)] & 1 << i % 8);
  for (let offset = 0; offset <= Math.floor((CLMM_MAX_TICK - CLMM_MIN_TICK) / step) + 1; offset++) {
    const next = start + (down ? -offset : offset) * step;
    if (next > CLMM_MAX_TICK || next + step <= CLMM_MIN_TICK) break;
    const index = next / step;
    let initialized;
    if (index >= -512 && index < 512) initialized = bit(d, 904, index + 512);
    else {
      if (!extension) {
        bitmap = PublicKey11.findProgramAddressSync(
          [Buffer.from("pool_tick_array_bitmap_extension"), hint.pool.toBuffer()],
          CACHED_CLMM_PROGRAM
        )[0];
        extension = Buffer.from(
          snapshot.get(bitmap, ctx, CACHED_CLMM_PROGRAM).data
        );
        if (extension.length < 1832 || extension.subarray(0, 8).toString("hex") !== "3c9624db61808b99" || !extension.subarray(8, 40).equals(hint.pool.toBuffer()))
          throw Error("Invalid CLMM bitmap extension");
      }
      const ed = extension;
      const distance = -index - 513, pos = index >= 512 ? index - 512 : Math.floor(distance / 512) * 512 + 511 - distance % 512;
      if (pos < 0 || pos >= 7168)
        throw Error("CLMM bitmap index outside range");
      initialized = bit(ed, index >= 512 ? 40 : 936, pos);
    }
    if (!initialized) continue;
    const seed = Buffer.alloc(4);
    seed.writeInt32BE(next);
    const address = PublicKey11.findProgramAddressSync(
      [Buffer.from("tick_array"), hint.pool.toBuffer(), seed],
      CACHED_CLMM_PROGRAM
    )[0], td = Buffer.from(snapshot.get(address, ctx, CACHED_CLMM_PROGRAM).data);
    if (td.length < 10240 || td.subarray(0, 8).toString("hex") !== "c09b55cd31f9812a" || !td.subarray(8, 40).equals(hint.pool.toBuffer()) || td.readInt32LE(40) !== next)
      throw Error("Invalid CLMM tick array");
    for (let i = 0; i < 60; i++) {
      const o = 44 + i * 168, gross = wide3(td, o + 20), orders = td.readBigUInt64LE(o + 124), partial = td.readBigUInt64LE(o + 132);
      if (gross || orders || partial) {
        const tick = td.readInt32LE(o);
        if (tick !== next + i * spacing)
          throw Error("CLMM tick index mismatch");
        const net = wide3(td, o + 4);
        ticks.push({
          tick,
          liquidityNet: net >= 1n << 127n ? net - (1n << 128n) : net,
          liquidityGross: gross,
          orders,
          partialOrders: partial
        });
      }
    }
    arrays.push(address);
    if (arrays.length > maximumArrays)
      throw Error("CLMM quote exceeds array budget");
    const boundary = down ? Math.max(next, CLMM_MIN_TICK) : Math.min(next + step - 1, CLMM_MAX_TICK), limit = clmmSqrtPriceAtTick(boundary);
    if (down ? limit >= pool.sqrtPrice : limit <= pool.sqrtPrice) continue;
    const result = clmmSwapExactIn(
      pool,
      ticks,
      netInput,
      limit,
      d[390],
      d.subarray(1096, 1176),
      unixTimestamp,
      down
    );
    if (result.consumed === netInput) {
      const net = result.amountOut - calculateTokenTransferFee(result.amountOut, fo), minimum = net * BigInt(1e4 - slippageBps) / 10000n;
      if (!minimum) throw Error("CLMM quote has zero protected output");
      const quote = {
        amountIn: amount,
        estimatedNetAmountOut: net,
        minimumNetAmountOut: minimum,
        minimumAmountOut: minimum,
        stateSlot: ctx.slot,
        epoch: ctx.epoch,
        sqrtPriceLimit: limit
      };
      const accounts = {
        payer,
        amm_config: key(9),
        pool_state: hint.pool,
        input_token_account: getAssociatedTokenAddressSync(
          hint.inputMint,
          payer,
          true,
          mints[down ? 0 : 1].owner
        ),
        output_token_account: getAssociatedTokenAddressSync(
          hint.outputMint,
          payer,
          true,
          mints[down ? 1 : 0].owner
        ),
        input_vault: key(down ? 137 : 169),
        output_vault: key(down ? 169 : 137),
        observation_state: key(201),
        token_program: TOKEN_PROGRAM_ID2,
        token_program_2022: TOKEN_2022_PROGRAM_ID2,
        input_vault_mint: hint.inputMint,
        output_vault_mint: hint.outputMint,
        tick_arrays: arrays,
        tick_array_bitmap_extension: bitmap
      };
      return {
        accounts,
        quote,
        instruction: buildRaydiumClmmSwapV2(accounts, {
          amount,
          other_amount_threshold: minimum,
          sqrt_price_limit: limit,
          amount_specified_is_input: true
        })
      };
    }
    if (arrays.length >= maximumArrays)
      throw Error("CLMM quote exceeds array budget");
  }
  throw Error("Insufficient CLMM liquidity in supplied snapshot");
}

// src/trading/cached_route.ts
init_pumpswap();
init_pumpfun_builder();

// src/trading/cached_pumpfun.ts
init_params();
init_pumpfun_builder();
import { PublicKey as PublicKey15 } from "@solana/web3.js";
init_pumpfun_builder();
init_cached_pumpfun_config();
init_spl_token();
var WSOL = new PublicKey15("So11111111111111111111111111111111111111112");
var USDC = new PublicKey15("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
var NATIVE2022 = new PublicKey15("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");
var U644 = 1n << 64n;
var checked = (v) => {
  if (typeof v !== "bigint" || v < 0n || v >= U644) throw Error("PumpFun amount outside u64");
  return v;
};
function decodePumpFunCurrentFees(data, quote, marketCap, creatorOverride = 0n) {
  const d = Buffer.from(data);
  let offset = 41;
  if (d.length < 69 || !d.subarray(0, 8).equals(Buffer.from([143, 52, 146, 187, 219, 123, 76, 155])) || typeof marketCap !== "bigint" || marketCap < 0n || marketCap >= 1n << 128n) throw Error("Invalid PumpFun FeeConfig or market cap");
  const readFees = () => {
    if (offset + 24 > d.length) throw Error("Truncated PumpFun fees");
    const values = [d.readBigUInt64LE(offset), d.readBigUInt64LE(offset + 8), d.readBigUInt64LE(offset + 16)];
    offset += 24;
    if (values.some((v) => v > 10000n)) throw Error("Invalid PumpFun fee rate");
    return values;
  };
  const flat = readFees();
  const readTiers = () => {
    if (offset + 4 > d.length) throw Error("Truncated PumpFun fee tier count");
    const n = d.readUInt32LE(offset);
    offset += 4;
    if (n > Math.floor((d.length - offset) / 40)) throw Error("Truncated PumpFun fee tiers");
    const tiers2 = [];
    for (let i = 0; i < n; i++) {
      const threshold = d.readBigUInt64LE(offset) + (d.readBigUInt64LE(offset + 8) << 64n);
      offset += 16;
      if (i && threshold <= tiers2[i - 1].threshold) throw Error("PumpFun fee tiers are not strictly ordered");
      tiers2.push({ threshold, fees: readFees() });
    }
    return tiers2;
  };
  const tiers = readTiers(), stable = offset === d.length ? [] : readTiers(), exotic = offset === d.length ? [0n, 0n, 0n] : readFees();
  const native = quote.equals(PublicKey15.default) || quote.equals(WSOL) || quote.equals(NATIVE2022);
  let selected;
  if (native || quote.equals(USDC)) {
    const schedule = !native && stable.length ? stable : tiers;
    if (!schedule.length) throw Error("PumpFun fee tiers cannot be empty");
    selected = schedule[0].fees;
    for (const tier of schedule) {
      if (marketCap >= tier.threshold) selected = tier.fees;
      else break;
    }
  } else selected = exotic.some((v) => v !== 0n) ? exotic : flat;
  const protocolFeeBps = selected[1], creatorFeeBps = creatorOverride === 0n ? selected[2] : checked(creatorOverride);
  if (protocolFeeBps + creatorFeeBps > 10000n) throw Error("PumpFun combined fees exceed 100%");
  return { protocolFeeBps, creatorFeeBps };
}
function cachedPumpFun(snapshot, hint, context) {
  const curveBytes = Buffer.from(snapshot.get(hint.pool, context, PUMPFUN_PROGRAM_ID).data);
  const curve = decodePumpFunBondingCurveData(curveBytes, hint.pool);
  const quote = curve.quoteMint?.equals(PublicKey15.default) ? WSOL : curve.quoteMint ?? WSOL;
  const mint = hint.inputMint.equals(quote) ? hint.outputMint : hint.inputMint;
  hint.matches(mint, quote);
  if (!getBondingCurvePda(mint).equals(hint.pool) || curve.complete || curve.virtualTokenReserves === 0n || curve.virtualSolReserves === 0n) throw Error("Invalid, completed or mismatched PumpFun curve");
  const global = Buffer.from(snapshot.get(PUMPFUN_GLOBAL_ACCOUNT, context, PUMPFUN_PROGRAM_ID).data);
  if (global.length < 1045 || !global.subarray(0, 8).equals(Buffer.from([167, 232, 232, 177, 200, 108, 114, 127])) || global[8] > 1) throw Error("Invalid PumpFun Global");
  if (global.length > 1045 && global.length < 1054 || curveBytes.length > 115 && curveBytes.length < 123) throw Error("Truncated PumpFun configurable fee fields");
  if (global.length >= 1054 && global[1045] > 1) throw Error("Invalid PumpFun creator fee gate");
  let override = global.length >= 1054 && global[1045] === 1 && curveBytes.length >= 123 ? curveBytes.readBigUInt64LE(115) : 0n;
  if (override && override > global.readBigUInt64LE(1046)) throw Error("PumpFun creator fee exceeds Global maximum");
  const fee = Buffer.from(snapshot.get(PUMPFUN_FEE_CONFIG, context, PUMPFUN_FEE_PROGRAM).data);
  const [feeAddress, bump] = PublicKey15.findProgramAddressSync([Buffer.from("fee_config"), PUMPFUN_PROGRAM_ID.toBuffer()], PUMPFUN_FEE_PROGRAM);
  if (!feeAddress.equals(PUMPFUN_FEE_CONFIG) || fee.length < 9 || fee[8] !== bump) throw Error("PumpFun FeeConfig PDA bump mismatch");
  const mints = [mint, quote].map((k) => snapshot.get(k, context));
  const transferFees = mints.map((m) => tokenTransferFeeForEpoch(m.data, m.owner, context.epoch));
  if (transferFees.some((f) => f.basisPoints !== 0 && f.maximumFee !== 0n)) throw Error("PumpFun nonzero transfer-fee quotes are not yet verified");
  const supply = Buffer.from(mints[0].data).readBigUInt64LE(36);
  if (supply === 0n) throw Error("PumpFun mint supply is zero");
  const cap = (s) => s * curve.virtualSolReserves / curve.virtualTokenReserves;
  const buyFees = decodePumpFunCurrentFees(fee, quote, cap(supply), override);
  const sellFees = decodePumpFunCurrentFees(fee, quote, cap(curve.isMayhemMode ? supply : 1000000000000000n), override);
  snapshot.assertUsable();
  return { curve, mint, quote, buyFees, sellFees, tokenProgram: mints[0].owner, quoteTokenProgram: mints[1].owner };
}
function quoteCachedPumpFunExactIn(state, amount, buy, slippageBps = 0) {
  checked(amount);
  if (!amount || typeof buy !== "boolean" || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 9999) throw Error("Invalid PumpFun exact-in request");
  const c = state.curve, f = buy ? state.buyFees : state.sellFees, creator = c.creator.equals(PublicKey15.default) ? 0n : f.creatorFeeBps;
  for (const value of [c.virtualTokenReserves, c.virtualSolReserves, c.realTokenReserves, f.protocolFeeBps, f.creatorFeeBps]) checked(value);
  if (c.complete || !c.virtualTokenReserves || !c.virtualSolReserves || f.protocolFeeBps + f.creatorFeeBps > 10000n) throw Error("Invalid PumpFun quote state");
  let estimated;
  if (buy) {
    const net = (amount - 1n) * 10000n / (10000n + f.protocolFeeBps + creator);
    estimated = net * c.virtualTokenReserves / (c.virtualSolReserves + net);
    if (estimated > c.realTokenReserves) estimated = c.realTokenReserves;
  } else {
    const gross = amount * c.virtualSolReserves / (c.virtualTokenReserves + amount), fee = (bps) => (gross * bps + 9999n) / 10000n;
    estimated = gross - fee(f.protocolFeeBps) - fee(creator);
  }
  const minimum = estimated * BigInt(1e4 - slippageBps) / 10000n;
  if (estimated <= 0n || minimum <= 0n) throw Error("PumpFun quote has zero protected output");
  checked(estimated);
  return { amountIn: amount, estimatedNetAmountOut: estimated, minimumNetAmountOut: minimum, fees: f };
}
function prepareCachedPumpFunRouteLeg(snapshot, hint, context, payer, amount, slippageBps, allowNative) {
  if (payer.equals(PublicKey15.default)) throw Error("Missing PumpFun payer");
  const state = cachedPumpFun(snapshot, hint, context);
  if (state.quote.equals(WSOL) && !allowNative) throw Error("PumpFun native quote requires cached trade settlement");
  const buy = hint.inputMint.equals(state.quote), quote = quoteCachedPumpFunExactIn(state, amount, buy, slippageBps);
  if (!state.quoteTokenProgram.equals(TOKEN_PROGRAM_ID)) throw Error("PumpFun V2 quote token program is unsupported");
  if (state.mint.toBase58().endsWith("pump") && !state.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) throw Error("PumpFun mint suffix and token program mismatch");
  const raw = Buffer.from(snapshot.get(hint.pool, context, PUMPFUN_PROGRAM_ID).data);
  if (raw.length >= 125 && raw[124] !== 0) throw Error("PumpFun holder-reward account layout is not yet verified");
  const config = getPumpFunFeeSharingConfigPda(state.mint), sharing = snapshot.getOptional(config, context, PUMPFUN_FEE_PROGRAM);
  const active = sharing ? decodePumpFunSharingCreatorVault(sharing.data, state.mint) : void 0;
  const creatorVault = active ?? getCreatorVaultPda(state.curve.creator);
  const g = Buffer.from(snapshot.get(PUMPFUN_GLOBAL_ACCOUNT, context, PUMPFUN_PROGRAM_ID).data);
  const firstNonzero = (start, n) => {
    for (let i = 0; i < n; i++) {
      const key = new PublicKey15(g.subarray(start + 32 * i, start + 32 * (i + 1)));
      if (!key.equals(PublicKey15.default)) return key;
    }
    throw Error("Missing PumpFun current fee recipient");
  };
  const recipient = firstNonzero(state.curve.isMayhemMode ? 483 : 41, 1), buyback = firstNonzero(741, 8);
  const protocolParams = { bondingCurve: state.curve, quoteMint: state.quote, tokenProgram: state.tokenProgram, creatorVault, feeSharingCreatorVaultIfActive: active, feeRecipient: recipient };
  const swaps = buy ? buildPumpFunBuyV2Instructions({ payer, inputMint: state.quote, outputMint: state.mint, inputAmount: amount, protocolParams, createOutputMintAta: false, createInputMintAta: false, useExactSolAmount: true }) : buildPumpFunSellV2Instructions({ payer, inputMint: state.mint, outputMint: state.quote, inputAmount: amount, protocolParams, createOutputMintAta: false, fixedOutputAmount: quote.minimumNetAmountOut });
  if (swaps.length !== 1 || swaps[0].keys.length !== (buy ? 27 : 26)) throw Error("Unexpected PumpFun V2 layout");
  const instruction2 = swaps[0];
  instruction2.data.writeBigUInt64LE(amount, 8);
  instruction2.data.writeBigUInt64LE(quote.minimumNetAmountOut, 16);
  instruction2.keys[6].pubkey = recipient;
  instruction2.keys[7].pubkey = getAssociatedTokenAddressSync(state.quote, recipient, true, TOKEN_PROGRAM_ID);
  instruction2.keys[8].pubkey = buyback;
  instruction2.keys[8].isWritable = true;
  instruction2.keys[9].pubkey = getAssociatedTokenAddressSync(state.quote, buyback, true, TOKEN_PROGRAM_ID);
  snapshot.assertUsable();
  return { state, quote, instruction: instruction2 };
}

// src/trading/cached_dlmm.ts
init_dlmm();
import { PublicKey as PublicKey16 } from "@solana/web3.js";
init_spl_token();
var DLMM2 = new PublicKey16("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
var CACHED_DLMM_PROGRAM = DLMM2;
var wide = (d, o) => d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n);
function decodeDlmmBins(data, pool, index) {
  const d = Buffer.from(data);
  if (!Number.isSafeInteger(index) || index < -6338 || index > 6337 || d.length < 10136 || d.subarray(0, 8).toString("hex") !== "5c8e5cdc059446b5" || d.readBigInt64LE(8) !== BigInt(index) || !d.subarray(24, 56).equals(pool.toBuffer()))
    throw Error("Invalid DLMM bin array identity");
  const result = [];
  for (let i = 0; i < 70; i++) {
    const o = 56 + i * 144, amountX = d.readBigUInt64LE(o), amountY = d.readBigUInt64LE(o + 8), price = wide(d, o + 16), openOrder = d.readBigUInt64LE(o + 112), processedOrder = d.readBigUInt64LE(o + 128);
    if (!price) {
      if (amountX || amountY || openOrder || processedOrder)
        throw Error("Zero DLMM bin price with liquidity");
      continue;
    }
    const binId = index * 70 + i;
    if (binId < -443636 || binId > 443636)
      throw Error("DLMM bin outside range");
    result.push({
      binId,
      amountX,
      amountY,
      price,
      openOrder,
      processedOrder,
      askSide: d[o + 140]
    });
  }
  return result;
}
function prepareCachedDlmm(snapshot, hint, ctx, unixTimestamp, payer, amount, slippageBps = 0, maximumArrays = 8) {
  if (typeof amount !== "bigint" || amount <= 0n || amount >= 1n << 64n || typeof unixTimestamp !== "bigint" || unixTimestamp < 0n || unixTimestamp >= 1n << 63n || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 1e4 || !Number.isInteger(maximumArrays) || maximumArrays < 1 || maximumArrays > 32)
    throw Error("Invalid cached DLMM request");
  const d = Buffer.from(snapshot.get(hint.pool, ctx, DLMM2).data);
  if (d.length < 904 || d.subarray(0, 8).toString("hex") !== "210b3162b565b10d" || d[82] !== 0)
    throw Error("Disabled or invalid DLMM pool");
  const key = (o) => new PublicKey16(d.subarray(o, o + 32));
  hint.matches(key(88), key(120));
  if (d[86] > 1 || (d[86] === 0 ? ctx.slot : unixTimestamp) < d.readBigUInt64LE(816))
    throw Error("DLMM not activated");
  if (d[35] > 2) throw Error("Unknown DLMM function type");
  const orders = d[35] === 2 || d[35] === 0 && key(264).equals(PublicKey16.default) && key(408).equals(PublicKey16.default);
  const state = {
    activeId: d.readInt32LE(76),
    binStep: d.readUInt16LE(80),
    feeMode: d[36],
    static: {
      baseFactor: d.readUInt16LE(8),
      power: d[34],
      control: d.readUInt32LE(16),
      maximumVolatility: d.readUInt32LE(20),
      filterPeriod: d.readUInt16LE(10),
      decayPeriod: d.readUInt16LE(12),
      reductionFactor: d.readUInt16LE(14)
    },
    variable: {
      volatility: d.readUInt32LE(40),
      reference: d.readUInt32LE(44),
      indexReference: d.readInt32LE(48),
      lastTimestamp: d.readBigInt64LE(56)
    }
  };
  const mints = [snapshot.get(key(88), ctx), snapshot.get(key(120), ctx)], fees = mints.map(
    (a) => tokenTransferFeeForEpoch(a.data, a.owner, ctx.epoch)
  ), down = hint.inputMint.equals(key(88)), fi = fees[down ? 0 : 1], fo = fees[down ? 1 : 0], netInput = amount - calculateTokenTransferFee(amount, fi);
  if (!netInput) throw Error("Zero DLMM input after transfer fee");
  const arrays = [], loaded = [], bins = [];
  let bitmap, extension;
  for (let offset = 0; offset < 12676; offset++) {
    const index = Math.floor(state.activeId / 70) + (down ? -offset : offset);
    if (index * 70 > 443636 || (index + 1) * 70 <= -443636) break;
    let initialized;
    if (index >= -512 && index < 512)
      initialized = Boolean(
        d[584 + Math.floor((index + 512) / 8)] & 1 << (index + 512) % 8
      );
    else {
      if (!extension) {
        bitmap = PublicKey16.findProgramAddressSync(
          [Buffer.from("bitmap"), hint.pool.toBuffer()],
          DLMM2
        )[0];
        extension = Buffer.from(snapshot.get(bitmap, ctx, DLMM2).data);
        if (extension.length < 1576 || extension.subarray(0, 8).toString("hex") !== "506f7c7137ed1205" || !extension.subarray(8, 40).equals(hint.pool.toBuffer()))
          throw Error("DLMM bitmap identity mismatch");
      }
      const pos = index >= 512 ? index - 512 : -index - 513;
      if (pos < 0 || pos >= 6144)
        throw Error("DLMM bitmap index outside range");
      initialized = Boolean(
        extension[(index >= 512 ? 40 : 808) + Math.floor(pos / 8)] & 1 << pos % 8
      );
    }
    loaded.push(index);
    if (initialized) {
      const seed = Buffer.alloc(8);
      seed.writeBigInt64LE(BigInt(index));
      const address = PublicKey16.findProgramAddressSync(
        [Buffer.from("bin_array"), hint.pool.toBuffer(), seed],
        DLMM2
      )[0];
      bins.push(
        ...decodeDlmmBins(
          snapshot.get(address, ctx, DLMM2).data,
          hint.pool,
          index
        )
      );
      arrays.push(address);
    }
    if (!initialized) continue;
    let r;
    try {
      r = dlmmSwapExactIn(
        state,
        bins,
        loaded,
        netInput,
        unixTimestamp,
        down,
        orders
      );
    } catch (e) {
      if (!(e instanceof InsufficientDlmmArrays)) throw e;
    }
    if (r?.complete && r.remainingIn === 0n && arrays.length) {
      const net = r.amountOut - calculateTokenTransferFee(r.amountOut, fo), minimum = net * BigInt(1e4 - slippageBps) / 10000n;
      if (!minimum) throw Error("Zero protected DLMM output");
      const quote = {
        amountIn: amount,
        estimatedNetAmountOut: net,
        minimumNetAmountOut: minimum,
        minimumAmountOut: minimum,
        stateSlot: ctx.slot,
        epoch: ctx.epoch,
        binsCrossed: r.binsCrossed
      };
      const accounts = {
        lb_pair: hint.pool,
        reserve_x: key(152),
        reserve_y: key(184),
        user_token_in: getAssociatedTokenAddressSync(
          hint.inputMint,
          payer,
          true,
          mints[down ? 0 : 1].owner
        ),
        user_token_out: getAssociatedTokenAddressSync(
          hint.outputMint,
          payer,
          true,
          mints[down ? 1 : 0].owner
        ),
        token_x_mint: key(88),
        token_y_mint: key(120),
        oracle: key(552),
        user: payer,
        token_x_program: mints[0].owner,
        token_y_program: mints[1].owner,
        bin_arrays: arrays,
        bitmap_extension: bitmap
      };
      return {
        accounts,
        quote,
        instruction: buildMeteoraDlmmSwap2(accounts, amount, minimum)
      };
    }
    if (arrays.length >= maximumArrays)
      throw Error("DLMM quote exceeds array budget");
  }
  throw Error("Insufficient DLMM liquidity in supplied snapshot");
}

// src/trading/cached_whirlpool.ts
import { PublicKey as PublicKey17 } from "@solana/web3.js";

// src/calc/whirlpool.ts
var WHIRLPOOL_MIN_SQRT_PRICE = 4295048016n;
var WHIRLPOOL_MAX_SQRT_PRICE = 79226673515401279992447579055n;
var U645 = (1n << 64n) - 1n;
var U1284 = (1n << 128n) - 1n;
var POSITIVE = [
  79232123823359799118286999567n,
  79236085330515764027303304731n,
  79244008939048815603706035061n,
  79259858533276714757314932305n,
  79291567232598584799939703904n,
  79355022692464371645785046466n,
  79482085999252804386437311141n,
  79736823300114093921829183326n,
  80248749790819932309965073892n,
  81282483887344747381513967011n,
  83390072131320151908154831281n,
  87770609709833776024991924138n,
  97234110755111693312479820773n,
  119332217159966728226237229890n,
  179736315981702064433883588727n,
  407748233172238350107850275304n,
  2098478828474011932436660412517n,
  55581415166113811149459800483533n,
  38992368544603139932233054999993551n
];
var NEGATIVE = [
  18445821805675392311n,
  18444899583751176498n,
  18443055278223354162n,
  18439367220385604838n,
  18431993317065449817n,
  18417254355718160513n,
  18387811781193591352n,
  18329067761203520168n,
  18212142134806087854n,
  17980523815641551639n,
  17526086738831147013n,
  16651378430235024244n,
  15030750278693429944n,
  12247334978882834399n,
  8131365268884726200n,
  3584323654723342297n,
  696457651847595233n,
  26294789957452057n,
  37481735321082n
];
var ceil5 = (n, d) => (n + d - 1n) / d;
function uint3(n, maximum = U645) {
  if (typeof n !== "bigint" || n < 0n || n > maximum)
    throw Error("Whirlpool integer outside range");
  return n;
}
var min2 = (a, b) => a < b ? a : b;
var max2 = (a, b) => a > b ? a : b;
function whirlpoolSqrtPriceAtTick(tick) {
  if (!Number.isInteger(tick) || tick < CLMM_MIN_TICK || tick > CLMM_MAX_TICK)
    throw Error("Whirlpool tick outside range");
  const positive = tick >= 0, shift = positive ? 96n : 64n, factors = positive ? POSITIVE : NEGATIVE;
  let ratio = 1n << shift;
  for (let b = 0; b < factors.length; b++)
    if (Math.abs(tick) & 1 << b) ratio = ratio * factors[b] >> shift;
  return positive ? ratio >> 32n : ratio;
}
function whirlpoolTickAtSqrtPrice(price) {
  uint3(price, U1284);
  if (price < WHIRLPOOL_MIN_SQRT_PRICE || price > WHIRLPOOL_MAX_SQRT_PRICE)
    throw Error("Whirlpool price outside range");
  let lo = CLMM_MIN_TICK, hi = CLMM_MAX_TICK;
  while (lo < hi) {
    const m = Math.floor((lo + hi + 1) / 2);
    if (whirlpoolSqrtPriceAtTick(m) <= price) lo = m;
    else hi = m - 1;
  }
  return lo;
}
function whirlpoolSwapExactIn(pool, ticks, arrayStarts, amount, timestamp, down, adaptive, limit = 0n) {
  uint3(amount);
  uint3(timestamp);
  uint3(pool.sqrtPrice, U1284);
  uint3(pool.liquidity, U1284);
  if (!amount || typeof down !== "boolean" || !Number.isInteger(pool.tickSpacing) || pool.tickSpacing < 1 || pool.tickSpacing > 65535 || !Number.isInteger(pool.feeRate) || pool.feeRate < 0 || pool.feeRate > 65535 || !Number.isInteger(pool.tickCurrent) || pool.tickCurrent < CLMM_MIN_TICK || pool.tickCurrent > CLMM_MAX_TICK || pool.sqrtPrice < WHIRLPOOL_MIN_SQRT_PRICE || pool.sqrtPrice > WHIRLPOOL_MAX_SQRT_PRICE)
    throw Error("Invalid Whirlpool pool/input");
  const starts = [...arrayStarts].sort((a, b) => a - b), step = 88 * pool.tickSpacing;
  if (starts.length < 1 || starts.length > 6 || starts.some((s) => !Number.isInteger(s) || s % step !== 0 || s > CLMM_MAX_TICK || s + step <= CLMM_MIN_TICK) || starts.slice(1).some((s, i) => s - starts[i] !== step))
    throw Error("Invalid Whirlpool tick array sequence");
  const lower = Math.max(starts[0], CLMM_MIN_TICK), upper = Math.min(starts[starts.length - 1] + step - 1, CLMM_MAX_TICK);
  uint3(limit, U1284);
  limit = limit || (down ? WHIRLPOOL_MIN_SQRT_PRICE : WHIRLPOOL_MAX_SQRT_PRICE);
  if (limit < WHIRLPOOL_MIN_SQRT_PRICE || limit > WHIRLPOOL_MAX_SQRT_PRICE || (down ? limit >= pool.sqrtPrice : limit <= pool.sqrtPrice))
    throw Error("Invalid Whirlpool price limit");
  for (const t of ticks)
    if (!Number.isInteger(t.tick) || t.tick < lower || t.tick > upper || t.tick % pool.tickSpacing || typeof t.liquidityNet !== "bigint" || t.liquidityNet < -(1n << 127n) || t.liquidityNet >= 1n << 127n)
      throw Error("Invalid Whirlpool tick");
  const orderedTicks = ticks.every((t, i) => i === 0 || ticks[i - 1].tick < t.tick) ? ticks : [...ticks].sort((a, b) => a.tick - b.tick);
  for (let i = 1; i < orderedTicks.length; i++)
    if (orderedTicks[i - 1].tick === orderedTicks[i].tick)
      throw Error("Duplicate Whirlpool tick");
  let cachedIndex, cachedPrice = 0n;
  let group = 0, reference = 0, volatilityReference = 0, maximum = 0, control = 0, groupSize = 1, lowerGroup, upperGroup;
  if (adaptive) {
    const a = adaptive;
    for (const v of [
      a.filterPeriod,
      a.decayPeriod,
      a.reductionFactor,
      a.tickGroupSize
    ])
      if (!Number.isInteger(v) || v < 0 || v > 65535)
        throw Error("Invalid Whirlpool adaptive fee");
    for (const v of [
      a.controlFactor,
      a.maximumVolatility,
      a.volatilityReference,
      a.volatility
    ])
      if (!Number.isInteger(v) || v < 0 || v > 4294967295)
        throw Error("Invalid Whirlpool adaptive fee");
    uint3(a.lastReferenceTimestamp);
    uint3(a.lastMajorSwapTimestamp);
    if (!a.tickGroupSize || a.reductionFactor > 1e4 || a.volatilityReference > a.maximumVolatility || a.maximumVolatility * a.tickGroupSize > 4294967295 || !Number.isInteger(a.referenceGroup) || a.referenceGroup < -(2 ** 31) || a.referenceGroup >= 2 ** 31)
      throw Error("Invalid Whirlpool adaptive fee");
    const last = max2(a.lastReferenceTimestamp, a.lastMajorSwapTimestamp);
    if (timestamp < last)
      throw Error("Whirlpool timestamp predates adaptive reference");
    groupSize = a.tickGroupSize;
    group = Math.floor(pool.tickCurrent / groupSize);
    reference = a.referenceGroup;
    volatilityReference = a.volatilityReference;
    maximum = a.maximumVolatility;
    control = a.controlFactor;
    if (timestamp - a.lastReferenceTimestamp > 3600n || timestamp - last >= BigInt(a.decayPeriod)) {
      reference = group;
      volatilityReference = 0;
    } else if (timestamp - last >= BigInt(a.filterPeriod)) {
      reference = group;
      volatilityReference = Math.floor(
        a.volatility * a.reductionFactor / 1e4
      );
    }
    if (volatilityReference > maximum)
      throw Error("Invalid Whirlpool volatility reference");
    const distance = Math.ceil((maximum - volatilityReference) / 1e4);
    if ((reference - distance) * groupSize > CLMM_MIN_TICK)
      lowerGroup = reference - distance;
    if ((reference + distance + 1) * groupSize < CLMM_MAX_TICK)
      upperGroup = reference + distance;
  }
  let current = pool.sqrtPrice, tick = pool.tickCurrent, liquidity = pool.liquidity, remaining = amount, output = 0n, fees = 0n, minimumFee = pool.feeRate, maximumFee = pool.feeRate, first = true;
  for (let iter = 0; iter < 8192; iter++) {
    if (remaining === 0n || current === limit)
      return {
        consumed: amount - remaining,
        amountOut: output,
        fee: fees,
        minimumFeeRate: minimumFee,
        maximumFeeRate: maximumFee,
        sqrtPrice: current,
        tickCurrent: tick,
        liquidity
      };
    if (down ? tick < lower : tick >= upper)
      throw Error("Whirlpool quote requires more tick arrays");
    let lo = 0, hi = orderedTicks.length;
    while (lo < hi) {
      const middle = Math.floor((lo + hi) / 2);
      if (orderedTicks[middle].tick <= tick) lo = middle + 1;
      else hi = middle;
    }
    const next = orderedTicks[down ? lo - 1 : lo];
    const nextIndex = next ? next.tick : down ? lower : upper;
    if (nextIndex !== cachedIndex) {
      cachedIndex = nextIndex;
      cachedPrice = whirlpoolSqrtPriceAtTick(nextIndex);
    }
    const nextPrice = cachedPrice, target = down ? max2(nextPrice, limit) : min2(nextPrice, limit);
    let fee = pool.feeRate, bound = target, skipped = false;
    if (adaptive) {
      const volatility = Math.min(
        volatilityReference + Math.abs(reference - group) * 1e4,
        maximum
      ), crossed = BigInt(volatility) * BigInt(groupSize);
      fee = Math.min(
        fee + Number(
          min2(
            ceil5(BigInt(control) * crossed * crossed, 10000000000000n),
            100000n
          )
        ),
        1e5
      );
      skipped = !control || liquidity === 0n;
      if (!skipped && lowerGroup !== void 0 && group < lowerGroup) {
        skipped = true;
        bound = down ? target : min2(target, whirlpoolSqrtPriceAtTick(lowerGroup * groupSize));
      } else if (!skipped && upperGroup !== void 0 && group > upperGroup) {
        skipped = true;
        bound = down ? max2(target, whirlpoolSqrtPriceAtTick((upperGroup + 1) * groupSize)) : target;
      } else if (!skipped) {
        const boundary = Math.max(
          CLMM_MIN_TICK,
          Math.min(CLMM_MAX_TICK, (down ? group : group + 1) * groupSize)
        ), price = whirlpoolSqrtPriceAtTick(boundary);
        bound = down ? max2(target, price) : min2(target, price);
      }
    }
    minimumFee = first ? fee : Math.min(minimumFee, fee);
    maximumFee = first ? fee : Math.max(maximumFee, fee);
    first = false;
    const old = current, r = clmmSwapStep(current, bound, liquidity, remaining, fee, down);
    remaining = uint3(remaining - r.amountIn - r.fee);
    output = uint3(output + r.amountOut);
    fees = uint3(fees + r.fee);
    current = r.sqrtPrice;
    if (current === nextPrice) {
      if (next)
        liquidity = uint3(
          liquidity + (down ? -next.liquidityNet : next.liquidityNet),
          U1284
        );
      tick = down ? nextIndex - 1 : nextIndex;
    } else if (current !== old) tick = whirlpoolTickAtSqrtPrice(current);
    if (adaptive) {
      if (skipped) {
        const ti = current === nextPrice ? nextIndex : whirlpoolTickAtSqrtPrice(current), onBoundary = ti % groupSize === 0 && current === whirlpoolSqrtPriceAtTick(ti), lastGroup = Math.floor(ti / groupSize) - (!down && onBoundary ? 1 : 0);
        if (down ? lastGroup < group : lastGroup > group) group = lastGroup;
      }
      group += down ? -1 : 1;
    }
  }
  throw Error("Whirlpool quote iteration budget exhausted");
}

// src/trading/cached_whirlpool.ts
init_spl_token();
var CACHED_WHIRLPOOL_PROGRAM = new PublicKey17(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);
var wide2 = (d, o) => d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n);
function decodeWhirlpoolTicks(data, pool, start, spacing) {
  if (!Number.isInteger(spacing) || spacing < 1 || spacing > 65535 || !Number.isInteger(start) || start % (88 * spacing))
    throw Error("Invalid Whirlpool tick array start/spacing");
  const d = Buffer.from(data), fixed = d.subarray(0, 8).toString("hex") === "4561bdbe6e0742bb", dynamic = d.subarray(0, 8).toString("hex") === "11d8f68ee1c7da38";
  if (!fixed && !dynamic) throw Error("Unknown Whirlpool array discriminator");
  const offset = fixed ? 9956 : 12;
  if (d.length < offset + 32 || d.length < 12 || d.readInt32LE(8) !== start || !d.subarray(offset, offset + 32).equals(pool.toBuffer()))
    throw Error("Whirlpool array identity mismatch");
  const ticks = [];
  let o = fixed ? 12 : 60;
  for (let i = 0; i < 88; i++) {
    if (o >= d.length || d[o] > 1)
      throw Error("Invalid or truncated Whirlpool tick tag");
    const initialized = d[o] === 1;
    o++;
    if (dynamic && Boolean(d[44 + Math.floor(i / 8)] & 1 << i % 8) !== initialized)
      throw Error("Whirlpool tick bitmap mismatch");
    if (fixed || initialized) {
      if (o + 112 > d.length) throw Error("Truncated Whirlpool tick");
      if (initialized) {
        const tick = start + i * spacing;
        if (tick < CLMM_MIN_TICK || tick > CLMM_MAX_TICK)
          throw Error("Whirlpool initialized tick outside range");
        const net = wide2(d, o);
        ticks.push({
          tick,
          liquidityNet: net >= 1n << 127n ? net - (1n << 128n) : net,
          liquidityGross: wide2(d, o + 16),
          orders: 0n,
          partialOrders: 0n
        });
      }
      o += 112;
    }
  }
  return ticks;
}
function prepareCachedWhirlpool(snapshot, hint, ctx, unixTimestamp, payer, amount, slippageBps = 0, maximumArrays = 6) {
  if (typeof amount !== "bigint" || amount <= 0n || amount >= 1n << 64n || typeof unixTimestamp !== "bigint" || unixTimestamp < 0n || unixTimestamp >= 1n << 64n || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 1e4 || !Number.isInteger(maximumArrays) || maximumArrays < 1 || maximumArrays > 32)
    throw Error("Invalid cached Whirlpool request");
  const d = Buffer.from(
    snapshot.get(hint.pool, ctx, CACHED_WHIRLPOOL_PROGRAM).data
  );
  if (d.length < 653 || d.subarray(0, 8).toString("hex") !== "3f95d10ce1806309")
    throw Error("Invalid Whirlpool pool");
  const key = (o) => new PublicKey17(d.subarray(o, o + 32));
  hint.matches(key(101), key(181));
  const spacing = d.readUInt16LE(41);
  if (!spacing) throw Error("Whirlpool spacing is zero");
  const mints = [snapshot.get(key(101), ctx), snapshot.get(key(181), ctx)], fees = mints.map(
    (a) => tokenTransferFeeForEpoch(a.data, a.owner, ctx.epoch)
  ), down = hint.inputMint.equals(key(101)), fi = fees[down ? 0 : 1], fo = fees[down ? 1 : 0], netInput = amount - calculateTokenTransferFee(amount, fi);
  if (!netInput) throw Error("Whirlpool input is zero after transfer fee");
  const pool = {
    sqrtPrice: wide2(d, 65),
    liquidity: wide2(d, 49),
    tickCurrent: d.readInt32LE(81),
    tickSpacing: spacing,
    feeRate: d.readUInt16LE(45)
  };
  let adaptive;
  if (d.readUInt16LE(43) !== spacing) {
    const oracle = PublicKey17.findProgramAddressSync(
      [Buffer.from("oracle"), hint.pool.toBuffer()],
      CACHED_WHIRLPOOL_PROGRAM
    )[0], od = Buffer.from(
      snapshot.get(oracle, ctx, CACHED_WHIRLPOOL_PROGRAM).data
    );
    if (od.length < 110 || od.subarray(0, 8).toString("hex") !== "8bc283b38cb3e5f4" || !od.subarray(8, 40).equals(hint.pool.toBuffer()))
      throw Error("Invalid Whirlpool oracle");
    if (unixTimestamp < od.readBigUInt64LE(40))
      throw Error("Whirlpool trade is not enabled");
    adaptive = {
      filterPeriod: od.readUInt16LE(48),
      decayPeriod: od.readUInt16LE(50),
      reductionFactor: od.readUInt16LE(52),
      controlFactor: od.readUInt32LE(54),
      maximumVolatility: od.readUInt32LE(58),
      tickGroupSize: od.readUInt16LE(62),
      lastReferenceTimestamp: od.readBigUInt64LE(82),
      lastMajorSwapTimestamp: od.readBigUInt64LE(90),
      volatilityReference: od.readUInt32LE(98),
      referenceGroup: od.readInt32LE(102),
      volatility: od.readUInt32LE(106)
    };
  }
  const step = 88 * spacing, shifted = pool.tickCurrent + (down ? 0 : spacing), start = Math.floor(shifted / step) * step, arrays = [], starts = [], ticks = [];
  for (let i = 0; i < Math.min(maximumArrays, 6); i++) {
    const st = start + (down ? -i : i) * step;
    if (st > CLMM_MAX_TICK || st + step <= CLMM_MIN_TICK) break;
    const address = PublicKey17.findProgramAddressSync(
      [
        Buffer.from("tick_array"),
        hint.pool.toBuffer(),
        Buffer.from(String(st))
      ],
      CACHED_WHIRLPOOL_PROGRAM
    )[0], td = snapshot.get(address, ctx, CACHED_WHIRLPOOL_PROGRAM).data;
    ticks.push(...decodeWhirlpoolTicks(td, hint.pool, st, spacing));
    starts.push(st);
    arrays.push(address);
    let result;
    try {
      result = whirlpoolSwapExactIn(
        pool,
        ticks,
        starts,
        netInput,
        unixTimestamp,
        down,
        adaptive
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes("requires more tick arrays"))
        continue;
      throw e;
    }
    if (result.consumed !== netInput) continue;
    const net = result.amountOut - calculateTokenTransferFee(result.amountOut, fo), minimum = net * BigInt(1e4 - slippageBps) / 10000n;
    if (!minimum) throw Error("Whirlpool quote has zero protected output");
    const quote = {
      amountIn: amount,
      estimatedNetAmountOut: net,
      minimumNetAmountOut: minimum,
      minimumAmountOut: minimum,
      stateSlot: ctx.slot,
      epoch: ctx.epoch,
      minimumFeeRate: result.minimumFeeRate,
      maximumFeeRate: result.maximumFeeRate
    };
    while (arrays.length < 3) arrays.push(arrays[arrays.length - 1]);
    const accounts = {
      token_program_a: mints[0].owner,
      token_program_b: mints[1].owner,
      token_authority: payer,
      whirlpool: hint.pool,
      mint_a: key(101),
      mint_b: key(181),
      owner_a: getAssociatedTokenAddressSync(
        key(101),
        payer,
        true,
        mints[0].owner
      ),
      vault_a: key(133),
      owner_b: getAssociatedTokenAddressSync(
        key(181),
        payer,
        true,
        mints[1].owner
      ),
      vault_b: key(213),
      tick_arrays: arrays
    };
    return {
      accounts,
      quote,
      instruction: buildWhirlpoolSwapV2(accounts, {
        amount,
        other_amount_threshold: minimum,
        sqrt_price_limit: 0n,
        amount_specified_is_input: true,
        a_to_b: down
      })
    };
  }
  throw Error("Whirlpool quote exceeds loaded array budget");
}

// src/trading/cached_route.ts
init_spl_token();
function prepareCachedRoute(snapshot, hints, ctx, unixTimestamp, payer, amount, slippageBps = 100, maximumArrays = 8, allowPumpFunNativeSettlement = false) {
  if (typeof amount !== "bigint" || amount <= 0n || amount >= 1n << 64n || typeof unixTimestamp !== "bigint" || unixTimestamp < 0n || unixTimestamp >= 1n << 64n || hints.length < 1 || hints.length > 5 || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 1e4 || !Number.isInteger(maximumArrays) || maximumArrays < 1 || maximumArrays > 32)
    throw Error("Invalid cached route request");
  if (new Set(hints.map((h) => h.pool.toBase58())).size !== hints.length)
    throw Error("Route reuses a pool and would require changed-state quoting");
  const mints = [hints[0].inputMint, ...hints.map((h) => h.outputMint)];
  if (new Set(mints.map((m) => m.toBase58())).size !== mints.length)
    throw Error("Route contains an asset cycle");
  for (let i = 1; i < hints.length; i++)
    if (!hints[i - 1].outputMint.equals(hints[i].inputMint))
      throw Error("Disconnected route");
  const legs = [];
  let spend = amount;
  for (const hint of hints) {
    const program = snapshot.get(hint.pool, ctx).owner;
    let used, estimated, minimum, instruction2;
    if (program.equals(PUMPSWAP_PROGRAM)) {
      const r = snapshot.preparePumpSwap(hint, ctx, payer, spend, slippageBps);
      used = r.quote.amountIn;
      estimated = r.quote.amountOut;
      minimum = r.quote.minimumAmountOut;
      instruction2 = r.instruction;
    } else if (program.equals(CACHED_AMM_V4_PROGRAM)) {
      const r = snapshot.prepareAmmV4(
        hint,
        ctx,
        unixTimestamp,
        payer,
        spend,
        slippageBps
      );
      used = r.quote.amountIn;
      estimated = r.quote.amountOut;
      minimum = r.quote.minimumAmountOut;
      instruction2 = r.instruction;
    } else if (program.equals(CACHED_CLMM_PROGRAM)) {
      const r = snapshot.prepareClmm(
        hint,
        ctx,
        unixTimestamp,
        payer,
        spend,
        slippageBps,
        maximumArrays
      );
      used = r.quote.amountIn;
      estimated = r.quote.estimatedNetAmountOut;
      minimum = r.quote.minimumNetAmountOut;
      instruction2 = r.instruction;
    } else if (program.equals(CACHED_WHIRLPOOL_PROGRAM)) {
      const r = snapshot.prepareWhirlpool(
        hint,
        ctx,
        unixTimestamp,
        payer,
        spend,
        slippageBps,
        maximumArrays
      );
      used = r.quote.amountIn;
      estimated = r.quote.estimatedNetAmountOut;
      minimum = r.quote.minimumNetAmountOut;
      instruction2 = r.instruction;
    } else if (program.equals(CACHED_DLMM_PROGRAM)) {
      const r = snapshot.prepareDlmm(
        hint,
        ctx,
        unixTimestamp,
        payer,
        spend,
        slippageBps,
        maximumArrays
      );
      used = r.quote.amountIn;
      estimated = r.quote.estimatedNetAmountOut;
      minimum = r.quote.minimumNetAmountOut;
      instruction2 = r.instruction;
    } else if (program.equals(PUMPFUN_PROGRAM_ID)) {
      const r = prepareCachedPumpFunRouteLeg(snapshot, hint, ctx, payer, spend, slippageBps, allowPumpFunNativeSettlement);
      used = r.quote.amountIn;
      estimated = r.quote.estimatedNetAmountOut;
      minimum = r.quote.minimumNetAmountOut;
      instruction2 = r.instruction;
    } else if (program.equals(CACHED_CPMM_PROGRAM)) {
      const r = snapshot.prepareCpmm(
        hint,
        ctx,
        unixTimestamp,
        payer,
        spend,
        slippageBps
      );
      used = r.quote.amountIn;
      estimated = r.quote.amountOut;
      minimum = r.quote.minimumAmountOut;
      instruction2 = r.instruction;
    } else if (program.equals(STONKFUN_PROGRAM)) {
      const { accounts, state } = snapshot.launchlabCurve(hint, ctx), q = quoteLaunchLabExactIn(
        state,
        spend,
        hint.inputMint.equals(accounts.quoteMint),
        slippageBps
      );
      used = q.amountIn;
      estimated = quoteLaunchLabExactIn(
        state,
        spend,
        hint.inputMint.equals(accounts.quoteMint),
        0
      ).minimumAmountOut;
      minimum = q.minimumAmountOut;
      instruction2 = buildLaunchLabCurveExactIn(
        accounts,
        payer,
        used,
        minimum,
        hint.inputMint.equals(accounts.quoteMint)
      );
    } else
      throw Error("Pool protocol has no native cached quote implementation");
    if (used <= 0n || used > spend || minimum === 0n)
      throw Error("Route has zero output or overconsumes input");
    legs.push({
      hint,
      amountIn: used,
      estimatedNetAmountOut: estimated,
      minimumNetAmountOut: minimum,
      instruction: instruction2
    });
    spend = minimum;
  }
  const setupInstructions = mints.map((m) => {
    const program = snapshot.get(m, ctx).owner;
    return createAssociatedTokenAccountIdempotentInstruction(
      payer,
      getAssociatedTokenAddressSync(m, payer, true, program),
      payer,
      m,
      program
    );
  });
  return {
    legs,
    setupInstructions,
    swapInstructions: legs.map((l) => l.instruction),
    minimumNetAmountOut: spend,
    estimatedIntermediateResiduals: legs.slice(0, -1).map((l, i) => ({
      mint: l.hint.outputMint,
      amount: l.estimatedNetAmountOut - legs[i + 1].amountIn
    }))
  };
}

// src/trading/subscription_cache.ts
var protocols = {
  PumpFun: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  MeteoraDammV2: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  PumpSwap: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  LaunchLab: STONKFUN_PROGRAM.toBase58(),
  RaydiumCpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  RaydiumClmm: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  OrcaWhirlpool: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  MeteoraDlmm: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  RaydiumAmmV4: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
};
function u64(n) {
  if (typeof n !== "bigint" || n < 0n || n >= 1n << 64n)
    throw new Error("Value outside u64");
}
var PoolTradeHint = class _PoolTradeHint {
  constructor(pool, inputMint, outputMint) {
    this.pool = pool;
    this.inputMint = inputMint;
    this.outputMint = outputMint;
    if ([pool, inputMint, outputMint].some((k) => k.equals(PublicKey18.default)) || inputMint.equals(outputMint))
      throw new Error("Missing or identical pool/mint identity");
  }
  pool;
  inputMint;
  outputMint;
  static fromRouteLeg(leg) {
    if (protocols[leg.protocol] !== leg.program)
      throw new Error("Unsupported or mismatched route protocol");
    if (!leg.input_mint || !leg.output_mint)
      throw new Error("Route mints are unresolved");
    return new _PoolTradeHint(
      new PublicKey18(leg.pool),
      new PublicKey18(leg.input_mint),
      new PublicKey18(leg.output_mint)
    );
  }
  matches(base, quote) {
    if (base.equals(quote) || !(this.inputMint.equals(base) && this.outputMint.equals(quote) || this.inputMint.equals(quote) && this.outputMint.equals(base)))
      throw new Error("Route mint identity mismatch");
  }
};
var owned = (a) => ({
  ...a,
  data: Buffer.from(a.data)
});
var AccountCacheSnapshot = class {
  constructor(accounts, continuityGuard) {
    this.continuityGuard = continuityGuard;
    this.#accounts = new Map(
      [...accounts].map(([k, a]) => {
        u64(a.slot);
        u64(a.writeVersion);
        return [k, owned(a)];
      })
    );
  }
  continuityGuard;
  dammV2(hint, ctx, unixTimestamp) {
    return cachedDammV2(this, hint, ctx, unixTimestamp);
  }
  preparePumpSwap(hint, ctx, payer, amount, slippageBps = 0) {
    return prepareCachedPumpSwap(this, hint, ctx, payer, amount, slippageBps);
  }
  pumpSwap(hint, ctx) {
    return cachedPumpSwap(this, hint, ctx);
  }
  prepareDlmm(hint, ctx, unixTimestamp, payer, amount, slippageBps = 0, maximumArrays = 8) {
    return prepareCachedDlmm(
      this,
      hint,
      ctx,
      unixTimestamp,
      payer,
      amount,
      slippageBps,
      maximumArrays
    );
  }
  prepareWhirlpool(hint, ctx, unixTimestamp, payer, amount, slippageBps = 0, maximumArrays = 6) {
    return prepareCachedWhirlpool(
      this,
      hint,
      ctx,
      unixTimestamp,
      payer,
      amount,
      slippageBps,
      maximumArrays
    );
  }
  ammV4(hint, ctx, unixTimestamp) {
    return cachedAmmV4(this, hint, ctx, unixTimestamp);
  }
  prepareAmmV4(hint, ctx, unixTimestamp, payer, amount, slippageBps = 0) {
    return prepareCachedAmmV4(
      this,
      hint,
      ctx,
      unixTimestamp,
      payer,
      amount,
      slippageBps
    );
  }
  prepareRoute(hints, ctx, unixTimestamp, payer, amount, slippageBps = 100, maximumArrays = 8, allowPumpFunNativeSettlement = false) {
    return prepareCachedRoute(
      this,
      hints,
      ctx,
      unixTimestamp,
      payer,
      amount,
      slippageBps,
      maximumArrays,
      allowPumpFunNativeSettlement
    );
  }
  prepareClmm(hint, ctx, unixTimestamp, payer, amount, slippageBps = 0, maximumArrays = 8) {
    return prepareCachedClmm(
      this,
      hint,
      ctx,
      unixTimestamp,
      payer,
      amount,
      slippageBps,
      maximumArrays
    );
  }
  #accounts;
  assertUsable() {
    this.continuityGuard?.();
  }
  /** Observed zero-lamport tombstone is absent; an unobserved key still throws. */
  /** Includes explicit closed-account observations; unobserved keys still error. */
  getObservation(key, ctx) {
    this.assertUsable();
    for (const n of [ctx.slot, ctx.epoch, ctx.maximumSlotAge]) u64(n);
    const a = this.#accounts.get(key.toBase58());
    if (!a) throw Error("Missing cached account: " + key.toBase58());
    if (a.slot > ctx.slot || ctx.slot - a.slot > ctx.maximumSlotAge) throw Error("Cached account is future or stale");
    return owned(a);
  }
  getOptional(key, ctx, expectedOwner) {
    this.assertUsable();
    for (const n of [ctx.slot, ctx.epoch, ctx.maximumSlotAge]) u64(n);
    const a = this.#accounts.get(key.toBase58());
    if (!a) throw Error("Missing cached account: " + key.toBase58());
    if (a.slot > ctx.slot || ctx.slot - a.slot > ctx.maximumSlotAge) throw Error("Cached account is future or stale");
    if (!a.data.length) return null;
    if (expectedOwner && !a.owner.equals(expectedOwner)) throw Error("Cached account owner mismatch");
    return owned(a);
  }
  get(key, ctx, expectedOwner) {
    this.assertUsable();
    for (const n of [ctx.slot, ctx.epoch, ctx.maximumSlotAge]) u64(n);
    const a = this.#accounts.get(key.toBase58());
    if (!a) throw new Error("Missing cached account: " + key.toBase58());
    if (expectedOwner && !a.owner.equals(expectedOwner))
      throw new Error("Cached account owner mismatch");
    if (a.slot > ctx.slot || ctx.slot - a.slot > ctx.maximumSlotAge)
      throw new Error("Cached account is future or stale");
    if (!a.data.length) throw new Error("Cached account is closed");
    return owned(a);
  }
  stonkfunCurve(hint, ctx) {
    return this.launchlabState(hint, ctx, true);
  }
  launchlabCurve(hint, ctx) {
    return this.launchlabState(hint, ctx, false);
  }
  launchlabState(hint, ctx, strict) {
    const pool = this.get(hint.pool, ctx, STONKFUN_PROGRAM), d = Buffer.from(pool.data);
    if (d.length < 429 || d.subarray(0, 8).toString("hex") !== "f7ede3f5d7c3de46")
      throw new Error("Invalid cached LaunchLab pool");
    const key = (o) => new PublicKey18(d.subarray(o, o + 32));
    hint.matches(key(205), key(237));
    const gk = key(141), pk = key(173), global = this.get(gk, ctx, STONKFUN_PROGRAM), platform = this.get(pk, ctx, STONKFUN_PROGRAM), base = this.get(key(205), ctx), quote = this.get(key(237), ctx);
    const result = (strict ? decodeStonkFunCurve : decodeLaunchLabCurve)(
      { pubkey: hint.pool, ...pool },
      { pubkey: gk, ...global },
      { pubkey: pk, ...platform },
      base.owner,
      quote.owner,
      tokenTransferFeeForEpoch(base.data, base.owner, ctx.epoch),
      tokenTransferFeeForEpoch(quote.data, quote.owner, ctx.epoch)
    );
    const s = result.state;
    if (s.curveType !== 0 || s.tradeFeeRate + s.platformFeeRate + s.creatorFeeRate >= 1000000n)
      throw new Error("Invalid cached LaunchLab curve or fee configuration");
    return result;
  }
  cpmm(hint, ctx, unixTimestamp) {
    u64(unixTimestamp);
    const pool = this.get(hint.pool, ctx, CACHED_CPMM_PROGRAM), d = Buffer.from(pool.data);
    if (d.length < 637 || d.subarray(0, 8).toString("hex") !== "f7ede3f5d7c3de46" || d[329] & 4 || ![0, 1].includes(d[390]))
      throw new Error("Invalid or disabled cached CPMM pool");
    const key = (o) => new PublicKey18(d.subarray(o, o + 32)), number = (b, o) => b.readBigUInt64LE(o);
    hint.matches(key(168), key(200));
    const openTime = number(d, 373);
    if (unixTimestamp < openTime) throw new Error("CPMM pool is not open");
    const f = Buffer.from(this.get(key(8), ctx, CACHED_CPMM_PROGRAM).data);
    if (f.length < 236 || f.subarray(0, 8).toString("hex") !== "daf42168cbcb2b6f")
      throw new Error("Invalid cached CPMM config");
    const tradeFeeRate = number(f, 12), protocolFeeRate = number(f, 20), fundFeeRate = number(f, 28), creatorFeeRate = number(f, 108), enableCreatorFee = d[390] === 1;
    if (tradeFeeRate + (enableCreatorFee ? creatorFeeRate : 0n) >= 1000000n || protocolFeeRate + fundFeeRate > 1000000n || d[389] > 2)
      throw new Error("Invalid CPMM fee configuration");
    const reserve = (vault, mint, program, offsets) => {
      const v = Buffer.from(this.get(vault, ctx, program).data);
      if (v.length < 165 || !v.subarray(0, 32).equals(mint.toBuffer()) || !v.subarray(32, 64).equals(CACHED_CPMM_AUTHORITY.toBuffer()) || v[108] !== 1)
        throw new Error("Invalid cached CPMM vault");
      const n = number(v, 64) - offsets.reduce((sum, o) => sum + number(d, o), 0n);
      u64(n);
      return n;
    };
    const base = this.get(key(168), ctx, key(232)), quote = this.get(key(200), ctx, key(264));
    return {
      pool: hint.pool,
      config: key(8),
      baseMint: key(168),
      quoteMint: key(200),
      baseVault: key(72),
      quoteVault: key(104),
      baseTokenProgram: key(232),
      quoteTokenProgram: key(264),
      observation: key(296),
      baseReserve: reserve(key(72), key(168), key(232), [341, 357, 397]),
      quoteReserve: reserve(key(104), key(200), key(264), [349, 365, 405]),
      tradeFeeRate,
      protocolFeeRate,
      fundFeeRate,
      creatorFeeRate,
      creatorFeeOn: d[389],
      enableCreatorFee,
      baseTransferFee: tokenTransferFeeForEpoch(
        base.data,
        base.owner,
        ctx.epoch
      ),
      quoteTransferFee: tokenTransferFeeForEpoch(
        quote.data,
        quote.owner,
        ctx.epoch
      ),
      openTime
    };
  }
  prepareCpmm(hint, ctx, unixTimestamp, payer, amount, slippageBps = 0) {
    const state = this.cpmm(hint, ctx, unixTimestamp), baseIn = hint.inputMint.equals(state.baseMint), quote = quoteCachedCpmmExactIn(state, amount, baseIn, slippageBps);
    if (!quote.minimumAmountOut)
      throw Error("CPMM quote has zero protected output");
    return {
      state,
      quote,
      instruction: buildCachedCpmmExactIn(
        state,
        payer,
        quote.amountIn,
        quote.minimumAmountOut,
        baseIn
      )
    };
  }
  prepareStonkFunCurve(hint, ctx, payer, amount, slippageBps = 0) {
    const { accounts, state } = this.stonkfunCurve(hint, ctx), buy = hint.inputMint.equals(accounts.quoteMint), quote = quoteLaunchLabExactIn(state, amount, buy, slippageBps);
    return {
      accounts,
      quote,
      instruction: buildStonkFunCurveExactIn(
        accounts,
        payer,
        quote.amountIn,
        quote.minimumAmountOut,
        buy
      )
    };
  }
};
export {
  AccountCacheSnapshot,
  PoolTradeHint
};
