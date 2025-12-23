import BinanceLogo from '../components/ui/BinanceLogo';
import BybitLogo from '../components/ui/BybitLogo';
import KuCoinLogo from '../components/ui/KuCoinLogo';
import OKXLogo from '../components/ui/OKXLogo';
import CoinbaseLogo from '../components/ui/CoinbaseLogo';
import BitgetLogo from '../components/ui/BitgetLogo';
import KrakenLogo from '../components/ui/KrakenLogo';
import GateIOLogo from '../components/ui/GateIOLogo';
import BingXLogo from '../components/ui/BingXLogo';
import WeexLogo from '../components/ui/WeexLogo';

// Exchange definitions with required fields
export const EXCHANGES = [
  {
    id: 'binance',
    name: 'Binance',
    logo: BinanceLogo,
    fields: ['apiKey', 'secretKey']
  },
  {
    id: 'bybit',
    name: 'Bybit',
    logo: BybitLogo,
    fields: ['apiKey', 'secretKey']
  },
  {
    id: 'kucoin',
    name: 'KuCoin',
    logo: KuCoinLogo,
    fields: ['apiKey', 'secretKey', 'passphrase']
  },
  {
    id: 'okx',
    name: 'OKX',
    logo: OKXLogo,
    fields: ['apiKey', 'secretKey', 'passphrase']
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    logo: CoinbaseLogo,
    fields: ['apiKey', 'secretKey', 'passphrase']
  },
  {
    id: 'bitget',
    name: 'Bitget',
    logo: BitgetLogo,
    fields: ['apiKey', 'secretKey', 'passphrase']
  },
  {
    id: 'kraken',
    name: 'Kraken',
    logo: KrakenLogo,
    fields: ['apiKey', 'secretKey']
  },
  {
    id: 'gateio',
    name: 'Gate.io',
    logo: GateIOLogo,
    fields: ['apiKey', 'secretKey']
  },
  {
    id: 'bingx',
    name: 'BingX',
    logo: BingXLogo,
    fields: ['apiKey', 'secretKey']
  },
  {
    id: 'weex',
    name: 'WEEX',
    logo: WeexLogo,
    fields: ['apiKey', 'secretKey']
  }
];
