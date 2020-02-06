(async () => {
require('dotenv').config()
var ccxt = require ('ccxt')

var configs = {
  bitmex: {
    apiKey: process.env.APIKEY,
    secret: process.env.APISECRET,
  },
  deribit: {
    apiKey: process.env.DERIBITAPIKEY,
    secret: process.env.DERIBITAPISECRET
  }
}
//getExchange :: String -> StrMap -> Object
let getExchange = exchange => config => {
  let res = new ccxt[exchange](config)
  if (process.env.TESTNET === 'true') {
    res.urls.api = res.urls.test
  }
  return res
}

const exchanges = ['bitmex', 'deribit']
const exchangeAbstraction = method => argv => {
  let methods = {
    bitmex: {
      market: marketBitmex,
      position: positionBitmex,
      fundingRate: fundingRateBitmex,
      showPrice: showPriceBitmex
    },
    deribit: {
      market: marketDeribit,
      position: positionDeribit,
      fundingRate: fundingRateDeribit,
      showPrice:showPriceDeribit
    }
  }
  return methods[argv.exchange][method](argv)
}

function printSubmit(side, amount, symbol) {
  console.log(`Submitting a ${side} order for ${amount} on ${symbol}`)
}
function printOrderResult(status, price, id) {
  console.log(`Order status ${status} average price ${price}`)
  console.log(`Order ID: ${id}`)
}

async function marketBitmex (argv) {
  printSubmit(argv.side, argv.amount, argv.symbol)

  let exchange = getExchange('bitmex')(configs.bitmex)

  let orderResult = await exchange.privatePostOrder({
    symbol: argv.symbol,
    ordType: 'Market',
    side: (argv.side == 'buy' ? 'Buy' : 'Sell'),
    orderQty: argv.amount
  })
  ordStatus = orderResult.ordStatus
  ordPrice = orderResult.avgPx
  ordId = orderResult.orderID
  printOrderResult(ordStatus, ordPrice, ordId)
}

async function marketDeribit (argv) {
  printSubmit(argv.side, argv.amount, argv.symbol)
  const exchange = getExchange('deribit')(configs.deribit)
  const promise = argv.side === 'buy' ? exchange.privatePostBuy : exchange.privatePostSell
  let orderResult = await promise({
    instrument: argv.symbol === 'XBTUSD' ? 'BTC-PERPETUAL' : argv.symbol,
    amount: argv.amount,
    type: 'market',
  })
  orderResult = orderResult.result.order
  ordStatus = orderResult.state
  ordPrice = orderResult.avgPrice
  ordId = orderResult.orderId
  printOrderResult(ordStatus, ordPrice, ordId)

}

function printPosition({currency, quoteCurrency, positionAmount, price, entry, value}) {
  let humanText = `Position:\t ${positionAmount} ${quoteCurrency}\n` +
    `Current price:\t ${price} ${quoteCurrency}\n` +
    `Entry price:\t ${+entry.toFixed(2)} ${quoteCurrency}\n` +
    `Current value:\t ${+(value/100000000).toFixed(8)} ${currency}`
  let jsonText = JSON.stringify({
    positionAmount,
    price,
    entry: +entry.toFixed(2),
    value // has to be in satoshi
  })
  console.log(process.env.JSON_OUTPUT === 'true' ? jsonText : humanText)
}

async function positionBitmex(argv) {

  let exchange = getExchange('bitmex')(configs.bitmex)
  let positions = await exchange.privateGetPosition({
    filter: {
      isOpen: true,
      symbol: argv.symbol
    }
  })
  for (const position of positions) {
    printPosition({
      currency: position.currency,
      quoteCurrency: position.quoteCurrency,
      positionAmount: position.currentQty,
      price: position.lastPrice,
      entry: position.avgEntryPrice,
      value: position.lastValue
    })
  }
}

async function positionDeribit (argv) {
  let exchange = getExchange ('deribit') (configs.deribit)
  let positions = await exchange.privateGetPositions()
  for (const position of positions.result) {
    printPosition({
      currency: position.currency,
      quoteCurrency: 'USD',
      positionAmount: position.amount,
      price: position.markPrice,
      entry: position.averagePrice,
      value: Math.ceil(position.sizeBtc * 100000000)
    })
  }
}

function printFundingRate(symbol, rate) {
  console.log(`Instrument ${symbol} funding rate ` +
  `${rate} which is approx ` +
  `${+(rate*3*365*100).toFixed(2)} % p.a.`)
}

async function fundingRateBitmex (argv) {
  let exchange = getExchange('bitmex')({})
  let instruments = await exchange.publicGetInstrument({
    filter: {
      state: "Open",
    },
    symbol: argv.symbol
  })
  for (const instrument of instruments) {
    printFundingRate(instrument.symbol, instrument.fundingRate)
  }
}

async function fundingRateDeribit (argv) {
  let rp = require('request-promise')
  argv.symbol = argv.symbol === 'XBTUSD' ? 'BTC-PERPETUAL' : argv.symbol
  let fundingRate = await rp({
    uri: `https://${process.env.TESTNET === 'true' ? 'test.' : ''}deribit.com/api/v2/public/get_funding_chart_data`,
    qs: {
      instrument_name: argv.symbol,
      length: '8h'
    },
    json: true
  })
  fundingRate = fundingRate.result.interest_8h
  printFundingRate(argv.symbol, fundingRate)
}

async function showPriceBitmex (argv) {
  argv.symbol = argv.symbol === 'XBTUSD' ? 'BTC/USD' : argv.symbol
  let exchange = getExchange('bitmex')({})
  let price = await exchange.fetchTickers()
  let average = price[argv.symbol].average
  let text = `Average price for ${argv.symbol} is ${average}`
  let jsonText = {
    symbol: argv.symbol,
    averagePrice: average
  }
  console.log(process.env.JSON_OUTPUT === 'true' ?
    JSON.stringify(jsonText) :
    text
  );
}

async function showPriceDeribit (argv) {
  throw new Error('Deribit does not have ticker fetching support yet')
}

require('yargs')
  .scriptName('trade-bitmex')
  .usage('$0 <cmd> [args]')
  .command('market exchange side amount [symbol]', 'submit a market order', (yargs) => {
    yargs.positional('exchange', {
      type: 'string',
      describe: 'exchange to use',
      choices: exchanges,
    }).positional('side', {
      type: 'string',
      describe: 'either buy or sell',
      choices: ['buy', 'sell']
    }).positional('amount', {
      type: 'number',
      describe: 'amount to buy or sell'
    }).positional('symbol', {
      type: 'string',
      describe: 'which market to post order to, default XBTUSD',
      default: 'XBTUSD'
    })
  }, exchangeAbstraction('market'))
  .command('position exchange [symbol]', 'show current position', (yargs) => {
    yargs
    .positional('exchange', {
      type: 'string',
      describe: 'exchange to use',
      choices: exchanges,
    })
    .positional('symbol', {
      type: 'string',
      describe: 'which market to show position in, default XBTUSD',
      default: 'XBTUSD'
    })
  }, exchangeAbstraction('position'))
  .command('fundingrate exchange [symbol]', 'show funding rate', (yargs) => {
    yargs
    .positional('exchange', {
      type: 'string',
      describe: 'exchange to use',
      choices: exchanges,
    })
    .positional('symbol', {
      type: 'string',
      describe: 'which market to show funding rate of, default XBTUSD',
      default: 'XBTUSD'
    })
  }, exchangeAbstraction('fundingRate'))
  .command('show price exchange [symbol]', 'show price of crypto currency in fiat', (yargs) => {
    yargs
    .positional('exchange', {
      type: 'string',
      describe: 'exchange to use',
      choices: exchanges,
    })
    .positional('symbol', {
      type: 'string',
      describe: 'which market to show funding rate of, default XBTUSD',
      default: 'XBTUSD'
    })
  }, exchangeAbstraction('showPrice'))
  .help()
  .argv
})()
