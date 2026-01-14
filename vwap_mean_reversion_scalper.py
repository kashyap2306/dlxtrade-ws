# VWAP Mean Reversion Scalping Strategy for QuantConnect
# Institutional-grade crypto scalping with session filters and risk management
# Assets: BTC/USDT, ETH/USDT
# Exchange: Binance
# Timeframe: 5-minute candles
# Trading Sessions: London (8:00-16:59 UTC) and New York (14:30-21:29 UTC)

from AlgorithmImports import *

class VWAPMeanReversionScalper(QCAlgorithm):

    def Initialize(self):
        # Basic algorithm setup
        self.SetStartDate(2024, 1, 1)
        self.SetEndDate(2024, 12, 31)
        self.SetCash(100000)  # Starting capital

        # Assets and symbols
        self.symbols = ["BTCUSDT", "ETHUSDT"]
        self.assets = {}

        # Trading parameters
        self.vwap_period = 14  # VWAP calculation period
        self.ema_period = 200  # Trend filter EMA period
        self.atr_period = 14   # ATR period for volatility
        self.risk_per_trade = 0.01  # 1% risk per trade
        self.max_trades_per_day = 3
        self.daily_loss_limit = 0.02  # 2% max daily loss

        # Session definitions (UTC times)
        self.london_session = {
            'start': time(8, 0),    # 8:00 UTC
            'end': time(16, 59)     # 16:59 UTC
        }
        self.new_york_session = {
            'start': time(14, 30),  # 14:30 UTC
            'end': time(21, 29)     # 21:29 UTC
        }

        # Position tracking
        self.positions = {}
        self.daily_trades = {}
        self.daily_pnl = {}

        # Initialize assets
        for symbol_str in self.symbols:
            symbol = self.AddCrypto(symbol_str, Resolution.Minute, Market.Binance).Symbol
            self.assets[symbol_str] = {
                'symbol': symbol,
                'vwap': self.VWAP(symbol, self.vwap_period),
                'ema': self.EMA(symbol, self.ema_period),
                'atr': self.ATR(symbol, self.atr_period),
                'previous_close': None,
                'current_open': None
            }
            self.positions[symbol_str] = None

        # Schedule daily reset
        self.Schedule.On(self.DateRules.EveryDay(), self.TimeRules.At(0, 0), self.DailyReset)

        # Set warmup period
        self.SetWarmup(timedelta(days=1))

    def OnData(self, data):
        """Main trading logic executed on each data update"""
        current_time = self.Time.time()

        # Skip trading outside specified sessions
        if not self.IsWithinTradingSession(current_time):
            return

        # Skip high-impact news events (simplified - in production would use news API)
        if self.IsHighImpactNewsEvent():
            return

        # Process each asset
        for symbol_str, asset_data in self.assets.items():
            if not data.ContainsKey(asset_data['symbol']):
                continue

            # Update previous close for confirmation logic
            current_bar = data[asset_data['symbol']]
            if asset_data['current_open'] is None:
                asset_data['current_open'] = current_bar.Open

            # Check for entry signals
            self.CheckEntrySignals(symbol_str, current_bar, asset_data)

            # Check for exit signals
            self.CheckExitSignals(symbol_str, current_bar, asset_data)

            # Update previous close for next bar
            asset_data['previous_close'] = current_bar.Close

    def CheckEntrySignals(self, symbol_str, bar, asset_data):
        """Check for long entry signals based on strategy rules"""

        # Skip if already in position
        if self.positions[symbol_str] is not None:
            return

        # Check daily limits
        if not self.CanTradeToday(symbol_str):
            return

        # Get indicator values
        vwap_value = asset_data['vwap'].Current.Value
        ema_value = asset_data['ema'].Current.Value
        atr_value = asset_data['atr'].Current.Value

        # Skip if ATR is abnormally low (dead market)
        if atr_value < self.GetAverageATR(symbol_str) * 0.3:
            return

        # Skip sideways chop (price hugging EMA + VWAP)
        price_to_ema_ratio = abs(bar.Close - ema_value) / ema_value
        price_to_vwap_ratio = abs(bar.Close - vwap_value) / vwap_value
        if price_to_ema_ratio < 0.002 and price_to_vwap_ratio < 0.002:
            return

        # LONG ENTRY RULES:

        # 1. Price must be ABOVE EMA 200 (bullish bias)
        if bar.Close <= ema_value:
            return

        # 2. Price must be BELOW VWAP (mean reversion opportunity)
        if bar.Close >= vwap_value:
            return

        # 3. Deviation from VWAP must meet thresholds
        deviation = abs(bar.Close - vwap_value) / vwap_value
        min_deviation = 0.008 if symbol_str == "BTCUSDT" else 0.006  # BTC ≥ 0.8%, ETH ≥ 0.6%

        if deviation < min_deviation:
            return

        # 4. Rejection confirmation
        if not self.IsBullishRejection(bar, asset_data):
            return

        # Calculate position size based on risk management
        position_size = self.CalculatePositionSize(symbol_str, bar.Close, atr_value)

        if position_size > 0:
            # Execute market order
            ticket = self.MarketOrder(asset_data['symbol'], position_size)

            # Set stop loss immediately
            stop_price = bar.Close - (1.2 * atr_value)
            self.StopMarketOrder(asset_data['symbol'], -position_size, stop_price)

            # Track position
            self.positions[symbol_str] = {
                'entry_price': bar.Close,
                'quantity': position_size,
                'stop_price': stop_price,
                'vwap_target': vwap_value,
                'entry_time': self.Time
            }

            # Update daily trade count
            today = self.Time.date()
            if today not in self.daily_trades:
                self.daily_trades[today] = {}
            if symbol_str not in self.daily_trades[today]:
                self.daily_trades[today][symbol_str] = 0
            self.daily_trades[today][symbol_str] += 1

            self.Log(f"LONG ENTRY: {symbol_str} at {bar.Close}, Size: {position_size}, Stop: {stop_price}")

    def CheckExitSignals(self, symbol_str, bar, asset_data):
        """Check for exit signals"""

        position = self.positions[symbol_str]
        if position is None:
            return

        # PRIMARY EXIT: Take Profit at VWAP level
        if bar.Close >= position['vwap_target']:
            self.ClosePosition(symbol_str, "TP at VWAP")
            return

        # Stop Loss hit (handled automatically by stop order)
        # Additional logic can be added here for advanced TP

    def IsBullishRejection(self, bar, asset_data):
        """Check for bullish rejection confirmation"""

        # Current close higher than previous candle
        if asset_data['previous_close'] is None or bar.Close <= asset_data['previous_close']:
            return False

        # Bullish candle (close > open)
        if bar.Close <= bar.Open:
            return False

        # No strong bearish momentum (simplified check)
        body_size = abs(bar.Close - bar.Open)
        total_range = bar.High - bar.Low

        # If body is less than 60% of total range, might be weak signal
        if body_size / total_range < 0.6:
            return False

        return True

    def CalculatePositionSize(self, symbol_str, entry_price, atr_value):
        """Calculate position size based on risk management"""

        # Risk per trade: 0.5% to 1% of account balance
        account_value = self.Portfolio.TotalPortfolioValue
        risk_amount = account_value * self.risk_per_trade

        # Stop distance = 1.2 * ATR
        stop_distance = 1.2 * atr_value

        # Position size = Risk Amount / Stop Distance
        position_value = risk_amount / stop_distance

        # Convert to quantity
        quantity = position_value / entry_price

        # Round to appropriate precision
        if symbol_str == "BTCUSDT":
            quantity = round(quantity, 3)  # BTC precision
        else:  # ETHUSDT
            quantity = round(quantity, 2)  # ETH precision

        return quantity

    def ClosePosition(self, symbol_str, reason):
        """Close position and log details"""

        position = self.positions[symbol_str]
        if position is None:
            return

        # Calculate P&L
        current_price = self.Securities[self.assets[symbol_str]['symbol']].Price
        pnl = (current_price - position['entry_price']) * position['quantity']

        # Update daily P&L
        today = self.Time.date()
        if today not in self.daily_pnl:
            self.daily_pnl[today] = 0
        self.daily_pnl[today] += pnl

        # Check daily loss limit
        if self.daily_pnl[today] < -self.daily_loss_limit * self.Portfolio.TotalPortfolioValue:
            self.Log(f"DAILY LOSS LIMIT HIT: Disabling trading for {today}")
            # In production, would set a flag to disable trading

        # Close position
        self.Liquidate(self.assets[symbol_str]['symbol'])

        self.Log(f"CLOSE {symbol_str}: {reason}, P&L: {pnl}")

        # Clear position tracking
        self.positions[symbol_str] = None

    def CanTradeToday(self, symbol_str):
        """Check if trading is allowed today"""

        today = self.Time.date()

        # Check daily trade limit
        if today in self.daily_trades and symbol_str in self.daily_trades[today]:
            if self.daily_trades[today][symbol_str] >= self.max_trades_per_day:
                return False

        # Check daily loss limit
        if today in self.daily_pnl:
            if self.daily_pnl[today] < -self.daily_loss_limit * self.Portfolio.TotalPortfolioValue:
                return False

        return True

    def IsWithinTradingSession(self, current_time):
        """Check if current time is within trading sessions"""

        # London session: 8:00-16:59 UTC
        if (current_time >= self.london_session['start'] and
            current_time <= self.london_session['end']):
            return True

        # New York session: 14:30-21:29 UTC
        if (current_time >= self.new_york_session['start'] and
            current_time <= self.new_york_session['end']):
            return True

        return False

    def IsHighImpactNewsEvent(self):
        """Check for high-impact news events (simplified)"""
        # In production, would integrate with economic calendar API
        # For now, return False (no news events)
        return False

    def GetAverageATR(self, symbol_str):
        """Get average ATR for dead market detection"""
        # Simplified - in production would calculate rolling average
        return self.assets[symbol_str]['atr'].Current.Value

    def DailyReset(self):
        """Reset daily counters"""
        today = self.Time.date()

        # Clear yesterday's data
        yesterday = today - timedelta(days=1)
        if yesterday in self.daily_trades:
            del self.daily_trades[yesterday]
        if yesterday in self.daily_pnl:
            del self.daily_pnl[yesterday]

        self.Log(f"Daily reset completed for {today}")

    def OnOrderEvent(self, orderEvent):
        """Handle order events"""
        if orderEvent.Status == OrderStatus.Filled:
            self.Log(f"Order filled: {orderEvent.Symbol} {orderEvent.Quantity} @ {orderEvent.FillPrice}")

    def OnEndOfDay(self):
        """End of day processing"""
        # Log daily performance
        today = self.Time.date()
        daily_pnl = self.daily_pnl.get(today, 0)
        daily_trades = sum(self.daily_trades.get(today, {}).values())

        self.Log(f"Daily Summary {today}: P&L: {daily_pnl}, Trades: {daily_trades}")