import { MasterSymbol } from "../classes";
import log from "./log";
import kleur from "kleur";
import fs from "fs";
import path from "path";
import { Classification } from "../interfaces";
import { isEnvEnabled } from "./common-service";
import get from "lodash.get";
export const BINANCE = "binance";
export const BINANCE_FUTURES_USDM = "binance_futures_usdm";
export const BINANCE_FUTURES_COINM = "binance_futures_coinm";
export const BINANCEUS = "binanceus";
export const BITTREX = "bittrex";
export const COINBASE = "coinbase";
// export const FTX = "ftx"
export const KRAKEN = "kraken";
export const KRAKEN_FUTURES = "kraken_futures";
export const KUCOIN = "kucoin";
export const KUCOIN_FUTURES = "kucoin_futures"; // not on TV yet
export const OKX_SPOT = "okx_spot"; //formerly OKEX
export const OKX_SWAP = "okx_swap"; //formerly OKEX
export const OKX_FUTURES = "okx_futures"; //formerly OKEX
export const BYBIT_INVERSE = "bybit_inverse";
export const BYBIT_LINEAR = "bybit_linear";
export const BYBIT_SPOT = "bybit_spot";
export const BITMEX = "bitmex"; // unable to do multiple pairs in 3commas
export const SOURCES_AVAILABLE = [
    BINANCE,
    BINANCE_FUTURES_USDM,
    BINANCE_FUTURES_COINM,
    BINANCEUS,
    BITTREX,
    COINBASE,
    BYBIT_INVERSE,
    BYBIT_LINEAR,
    // BYBIT_SPOT, // spot is STILL not on tradingview
    // FTX,
    KRAKEN,
    KUCOIN,
    OKX_SPOT,
    OKX_SWAP
];
const logJson = (obj, name = "") => {
    log.trace(`${name} \n ${kleur.yellow(JSON.stringify(obj, null, 4))}`);
};
export const proxyMaybe = (url) => {
    if (process.env.PROXY_BASE) {
        // parse the url to get the host, path, and query segments
        const realUrl = new URL(url);
        return `${process.env.PROXY_BASE}/api/proxy?${realUrl.search}&host=${realUrl.host}&path=${realUrl.pathname}`;
    }
    else {
        return url;
    }
};
const fetchAndTransform = async (url, responsePath, transformer) => {
    const responseObject = await (await fetch(url)).json();
    const resultsArray = responsePath ? get(responseObject, responsePath) : responseObject;
    const masterSymbols = [];
    log.info(`${resultsArray.length} results returned from API`);
    let count = 0;
    for (const obj of resultsArray) {
        const masterSymbol = transformer(obj);
        if (masterSymbol) {
            if (count == 0 && isEnvEnabled(process.env.TEST_SAVE_RESPONSE)) {
                fs.writeFileSync(path.join(process.cwd(), "output", masterSymbol.source + "_in.json"), JSON.stringify(resultsArray, null, 2), { encoding: "utf-8" });
            }
            masterSymbols.push(masterSymbol);
            count += 1;
        }
    }
    log.info(`${masterSymbols.length} symbols parsed from results`);
    return masterSymbols;
};
export const fetchBitMex = async () => {
    const transformer = (obj) => {
        if (obj.expiry === null) {
            return new MasterSymbol(obj, BITMEX, obj.symbol, obj.quoteCurrency, `BITMEX:${obj.symbol}.P`, Classification.FUTURES_PERPETUAL);
        }
        else {
            return null;
        }
    };
    return fetchAndTransform("https://www.bitmex.com/api/v1/instrument/active", null, transformer);
};
export const fetchByBitInverse = async () => {
    const transformer = (obj) => {
        if (obj.status === "Trading") {
            let classification;
            let symbol = obj.symbol;
            let tvSuffix = "";
            if (obj.contractType == "InversePerpetual") {
                classification = Classification.FUTURES_PERPETUAL;
                tvSuffix = ".P";
            }
            else if (obj.contractType == "InverseFutures") {
                classification = Classification.FUTURES_DATED;
                const match = obj.symbol.match(/(.*?)(\d\d)$/);
                symbol = `${match[1]}20${match[2]}`;
            }
            else {
                log.error(`Found unknown contract type: ${obj.contractType}`);
            }
            return new MasterSymbol(obj, BYBIT_INVERSE, symbol, obj.quoteCoin, `BYBIT:${symbol}${tvSuffix}`, classification);
        }
        else {
            //logJson(obj, "ByBit Discarded:")
            return null;
        }
    };
    return fetchAndTransform("https://api.bybit.com/v5/market/instruments-info?category=inverse", "result.list", transformer);
};
export const fetchByBitLinear = async () => {
    const transformer = (obj) => {
        if (obj.status === "Trading") {
            let classification;
            let symbol = obj.symbol;
            if (obj.contractType == "LinearPerpetual") {
                classification = Classification.FUTURES_PERPETUAL;
            }
            else {
                log.error(`Found unknown contract type: ${obj.contractType}`);
            }
            return new MasterSymbol(obj, BYBIT_LINEAR, symbol, obj.quoteCoin, `BYBIT:${symbol}.P`, classification);
        }
        else {
            //logJson(obj, "ByBit Discarded:")
            return null;
        }
    };
    return fetchAndTransform("https://api.bybit.com/v5/market/instruments-info?category=linear", "result.list", transformer);
};
export const fetchByBitSpot = async () => {
    // actually these aren't on tradingview yet, even in march of 2023
    const transformer = (obj) => {
        return new MasterSymbol(obj, BYBIT_SPOT, obj.baseCoin, obj.quoteCoin, `BYBIT:${obj.symbol}`);
    };
    return fetchAndTransform("https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000", "result.list", transformer);
};
export const fetchKucoin = async () => {
    const transformer = (obj) => {
        if (obj.enableTrading) {
            const symbol = obj.name.replace("-", "");
            return new MasterSymbol(obj, KUCOIN, obj.baseCurrency, obj.quoteCurrency, `KUCOIN:${symbol}`);
        }
        else {
            //logJson(obj, "Kucoin Discarded:")
            return null;
        }
    };
    return fetchAndTransform("https://api.kucoin.com/api/v2/symbols", "data", transformer);
};
export const fetchKraken = async () => {
    const resp = await fetch("https://api.kraken.com/0/public/AssetPairs");
    const responseObject = await resp.json();
    // @ts-ignore
    const symbolsObject = responseObject.result;
    const masterSymbols = [];
    const keys = Object.keys(symbolsObject);
    log.info(`found ${keys.length} results from the API`);
    for (const key of keys) { // key = "AAVEAUD"
        const obj = symbolsObject[key];
        const [instrument, quoteAsset] = obj.wsname.split("\/"); // "AAVE\/AUD"
        masterSymbols.push(new MasterSymbol(obj, KRAKEN, instrument, quoteAsset));
    }
    log.info(`returning ${masterSymbols.length} results symbols parsed`);
    return masterSymbols;
};
export const fetchKrakenFutures = async () => {
    /*
          {
            "tag": "perpetual",
            "pair": "XBT:USD",
            "symbol": "pi_xbtusd",
            "markPrice": 36339.5,
            "bid": 36332.5,
            "bidSize": 1091,
            "ask": 36355.5,
            "askSize": 4080,
            "vol24h": 341903278,
            "openInterest": 89423744,
            "open24h": 34915,
            "last": 36374.5,
            "lastTime": "2022-01-24T18:50:06.030Z",
            "lastSize": 58,
            "suspended": false,
            "fundingRate": 3.55444348e-10,
            "fundingRatePrediction": -9.1005881e-10
          },
     */
    const transformer = (obj) => {
        if (obj.suspended === false) {
            const [baseCurrency, quoteCurrency] = obj.pair.split(":");
            let classification = null;
            if (obj.tag === "perpetual") {
                classification = Classification.FUTURES_PERPETUAL;
                return new MasterSymbol(obj, KRAKEN_FUTURES, obj.symbol, quoteCurrency, `KRAKEN:${baseCurrency}${quoteCurrency}.PM`, classification);
            }
            else {
                // TODO: dated futures
                return null;
            }
        }
        else {
            logJson(obj, `${KRAKEN_FUTURES} Discarded:"`);
            return null;
        }
    };
    return fetchAndTransform("https://futures.kraken.com/derivatives/api/v3/tickers", "tickers", transformer);
};
export const fetchBittrex = async () => {
    const transformer = (obj) => {
        if (obj.status === "ONLINE") {
            const classification = (obj.baseCurrencySymbol.match(/X\s(?:BULL|BEAR)\s/)) ? Classification.LEVERAGED_TOKEN : Classification.SPOT;
            return new MasterSymbol(obj, BITTREX, obj.baseCurrencySymbol, obj.quoteCurrencySymbol, null, classification);
        }
        else {
            //logJson(obj, "Bittrex Discarded:")
            return null;
        }
    };
    return fetchAndTransform("https://api.bittrex.com/v3/markets", null, transformer);
};
export const fetchCoinbase = async () => {
    const transformer = (obj) => {
        if (!obj.trading_disabled && obj.status == "online") {
            return new MasterSymbol(obj, COINBASE, obj.base_currency, obj.quote_currency);
        }
        else {
            //logJson(obj, "Coinbase Discarded:")
            return null;
        }
    };
    return fetchAndTransform("https://api.exchange.coinbase.com/products", null, transformer);
};
// export const fetchFtx = async (): Promise<MasterSymbol[]> => {
//
//     const levTokensTransformer = (obj) => {
//         return new MasterSymbol(obj, "FTX_LEV_TOKENS", obj.name, "USD", `FTX:${obj.underlying}`, Classification.FUTURES_DATED)
//     }
//     const levTokenSymbols = await fetchAndTransform("https://ftx.com/api/lt/tokens", "result", levTokensTransformer)
//
//     const levTokenNames = levTokenSymbols.map((ms) => ms.instrument)
//
//
//     const transformer = (obj) => {
//         if (obj.enabled) {
//             if (obj.type === "spot") {
//                 const classification: ClassificationType = levTokenNames.includes(obj.baseCurrency) ? Classification.LEVERAGED_TOKEN : Classification.SPOT
//                 return new MasterSymbol(obj, FTX, obj.baseCurrency, obj.quoteCurrency, null, classification)
//             } else if (obj.type == "future") {
//
//                 if (obj.tokenizedEquity) return null // eg. AAPL or AAPL-0326
//
//                 if (obj.name.match(/-PERP$/)) {
//                     return new MasterSymbol(obj, FTX, obj.name, "USD", `FTX:${obj.underlying}PERP`, Classification.FUTURES_PERPETUAL)
//
//                 } else if (obj.name.match(/-\d{4}$/)) { //AVAX-0326
//                     const [base, exp] = obj.name.split("-")
//                     return new MasterSymbol(obj, FTX, obj.name, "USD", `FTX:${base}${exp}`, Classification.FUTURES_DATED)
//                 } else {
//                     return null
//                 }
//             } else {
//                 return null
//             }
//         } else {
//
//             return null
//         }
//     }
//     return fetchAndTransform("https://ftx.com/api/markets", "result", transformer)
//
// }
export const fetchBinanceFuturesUsdM = async () => {
    const transformer = (obj) => {
        if (obj.status === "TRADING" && obj.contractType === "PERPETUAL") {
            return new MasterSymbol(obj, BINANCE_FUTURES_USDM, obj.symbol, obj.quoteAsset, `BINANCE:${obj.baseAsset}${obj.quoteAsset}.P`, Classification.FUTURES_PERPETUAL);
        }
        else {
            // logJson(obj, "Binance Futures Discarded:")
            //TODO: add expiring, contractType: NEXT_QUARTER/CURRENT_QUARTER, etc.
            return null;
        }
    };
    return fetchAndTransform(proxyMaybe("https://fapi.binance.com/fapi/v1/exchangeInfo"), "symbols", transformer);
};
export const fetchBinanceFuturesCoinM = async () => {
    const transformer = (obj) => {
        if (obj.contractStatus === "TRADING" && obj.contractType === "PERPETUAL") {
            return new MasterSymbol(obj, BINANCE_FUTURES_COINM, obj.symbol, obj.quoteAsset, `BINANCE:${obj.baseAsset}${obj.quoteAsset}.P`, Classification.FUTURES_PERPETUAL);
        }
        else {
            // logJson(obj, "Binance Futures Discarded:")
            return null;
        }
    };
    return fetchAndTransform(proxyMaybe("https://dapi.binance.com/dapi/v1/exchangeInfo"), "symbols", transformer);
};
export const fetchBinance = async (isUs) => {
    const exchange = isUs ? BINANCEUS : BINANCE;
    const url = isUs ? "https://api.binance.us/api/v3/exchangeInfo" : "https://api.binance.com/api/v3/exchangeInfo";
    const transformer = (obj) => {
        if (obj.status === "TRADING") {
            if (obj.isSpotTradingAllowed === true) {
                return new MasterSymbol(obj, exchange, obj.baseAsset, obj.quoteAsset);
            }
            else {
                return new MasterSymbol(obj, exchange, obj.baseAsset, obj.quoteAsset, null, Classification.LEVERAGED_TOKEN);
            }
        }
        else {
            // logJson(obj, `${exchange} Discarded`)
            return null;
        }
    };
    return fetchAndTransform(proxyMaybe(url), "symbols", transformer);
};
export const fetchOkxSpot = async () => {
    const transformer = (obj) => {
        return new MasterSymbol(obj, OKX_SPOT, obj.baseCcy, obj.quoteCcy, `OKEX:${obj.baseCcy}${obj.quoteCcy}`);
    };
    //NOTE: unable to get all instruments in same api call, that's why we separate
    return fetchAndTransform("https://www.okx.com/api/v5/public/instruments?instType=SPOT", "data", transformer);
};
export const fetchOkxSwap = async () => {
    const transformer = (obj) => {
        const symbol = obj.instFamily.replace("-", "");
        if (obj.ctType === "inverse") {
            return new MasterSymbol(obj, OKX_SWAP, symbol, obj.ctValCcy, `OKX:${symbol}.P`, Classification.FUTURES_PERPETUAL);
        }
        else if (obj.ctType === "linear") {
            return new MasterSymbol(obj, OKX_SWAP, symbol, obj.ctValCcy, `OKX:${obj.ctValCcy}${obj.settleCcy}.P`, Classification.FUTURES_PERPETUAL);
        }
        else {
            log.warn(`unable to parse ctType: ${obj.ctType}`);
            return null;
        }
    };
    return fetchAndTransform("https://www.okx.com/api/v5/public/instruments?instType=SWAP", "data", transformer);
};
// export const fetchOkxFutures = async (): Promise<MasterSymbol[]> => {
//     const transformer = (obj) => {
//         return new MasterSymbol(obj, OKX_FUTURES, obj.base_currency, obj.quote_currency, `OKEX:${obj.base_currency}${obj.quote_currency}`)
//     }
//     return fetchAndTransform("https://www.okx.com/api/v5/public/instruments?instType=FUTURES", "data", transformer)
// }
export const fetchSymbolsForSource = async (source) => {
    let symbolArray;
    switch (source) {
        case BINANCE_FUTURES_USDM:
            symbolArray = await fetchBinanceFuturesUsdM();
            break;
        case BINANCE_FUTURES_COINM:
            symbolArray = await fetchBinanceFuturesCoinM();
            break;
        case BINANCE:
            symbolArray = await fetchBinance(false);
            break;
        case BINANCEUS:
            symbolArray = await fetchBinance(true);
            break;
        // case FTX:
        //     symbolArray = await fetchFtx()
        //     break;
        case COINBASE:
            symbolArray = await fetchCoinbase();
            break;
        case BITTREX:
            symbolArray = await fetchBittrex();
            break;
        case KRAKEN:
            symbolArray = await fetchKraken();
            break;
        case KRAKEN_FUTURES:
            symbolArray = await fetchKrakenFutures();
            break;
        case KUCOIN:
            symbolArray = await fetchKucoin();
            break;
        case OKX_SPOT:
            symbolArray = await fetchOkxSpot();
            break;
        case OKX_SWAP:
            symbolArray = await fetchOkxSwap();
            break;
        case BYBIT_SPOT:
            symbolArray = await fetchByBitSpot();
            break;
        case BYBIT_LINEAR:
            symbolArray = await fetchByBitLinear();
            break;
        case BYBIT_INVERSE:
            symbolArray = await fetchByBitInverse();
            break;
        default:
            log.error(`Invalid source specified: ${kleur.yellow(source)} \n\n Choose one of the following:\n\n ${kleur.green(SOURCES_AVAILABLE.join(", "))}`);
            process.exit(1);
            return [];
    }
    return symbolArray;
};
//# sourceMappingURL=exchange-service.js.map