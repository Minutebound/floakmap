import type { GeoData } from './types'

export const SEED_DATA: GeoData = {
  parking: {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7594,39.5138] }, properties:{ name:'PACE Center Parking Garage', address:'20120 E. Mainstreet', city:'Parker', state:'CO', category:'parking', type:'Garage', spaces:296, free:'Yes', ev:'10 ChargePoint + 9 EV-ready', notes:'4-story, completed Winter 2025. ADA spaces available.' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7602,39.5149] }, properties:{ name:'PACE Center Lot (North)', address:'20000 Pikes Peak Ave', city:'Parker', state:'CO', category:'parking', type:'Surface Lot', free:'Yes', notes:'ADA spaces available' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7614,39.5131] }, properties:{ name:'The Schoolhouse South Lot', address:'19650 E. Mainstreet', city:'Parker', state:'CO', category:'parking', type:'Surface Lot', free:'Yes' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7590,39.5135] }, properties:{ name:'Pine Curve Lot', address:'E. of 20120 E. Mainstreet', city:'Parker', state:'CO', category:'parking', type:'Surface Lot', free:'Yes', notes:'Overflow parking for downtown' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7610,39.5090] }, properties:{ name:'Sulphur Gulch / S. Pine Dr Lot', address:'S. Pine Drive', city:'Parker', state:'CO', category:'parking', type:'Surface Lot', free:'Yes' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7620,39.5143] }, properties:{ name:'Parker Town Hall Lot', address:'20120 Mainstreet', city:'Parker', state:'CO', category:'parking', type:'Surface Lot', free:'Yes', notes:'ADA spaces' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7621,39.5002] }, properties:{ name:'Grace Baptist Church Lot', address:'10816 S. Parker Road', city:'Parker', state:'CO', category:'parking', type:'Surface Lot', free:'Events only', notes:'Paid parking for special events' } },
    ],
  },
  carwash: {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7614,39.4982] }, properties:{ name:'American Car Wash', address:'10345 S Parker Rd', city:'Parker', state:'CO', category:'carwash', type:'Tunnel', phone:'(720) 851-6103' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7691,39.5086] }, properties:{ name:'Take 5 Car Wash', address:'16941 Lincoln Ave', city:'Parker', state:'CO', category:'carwash', type:'Express', phone:'(720) 776-9673', notes:'Current operator at this address' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7422,39.5189] }, properties:{ name:'Cobblestone Car Wash (Cottonwood)', address:'18710 Cottonwood Dr', city:'Parker', state:'CO', category:'carwash', type:'Express + Self-Serve', phone:'(720) 445-8600' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7658,39.5264] }, properties:{ name:'Cobblestone Car Wash (Hess Rd)', address:'19509 Hess Rd', city:'Parker', state:'CO', category:'carwash', type:'Express', phone:'(720) 445-8600' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7697,39.5028] }, properties:{ name:'Cobblestone Car Wash (Twenty Mile)', address:'9572 Twenty Mile Rd', city:'Parker', state:'CO', category:'carwash', type:'Express', phone:'(720) 445-8600' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7418,39.5019] }, properties:{ name:'Country Coin Car Wash', address:'11703 N State Hwy 83', city:'Parker', state:'CO', category:'carwash', type:'Coin / Self-Serve', phone:'(303) 841-3532' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7445,39.5271] }, properties:{ name:'Hilltop Car Wash', address:'19739 E Parker Square Dr', city:'Parker', state:'CO', category:'carwash', type:'Tunnel', phone:'(720) 341-4301' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7528,39.5017] }, properties:{ name:'Lucky Dog Car & Pet Wash', address:'10003 Jordan Rd', city:'Parker', state:'CO', category:'carwash', type:'Touchless', phone:'(720) 352-9685', hours:'24 / 7' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7616,39.4973] }, properties:{ name:'Parker Automotive Inc', address:'10301 S Parker Rd', city:'Parker', state:'CO', category:'carwash', type:'Full-Service', phone:'(720) 370-7819', notes:'Est. 1978' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7677,39.5148] }, properties:{ name:'Quick Quack Car Wash', address:'Ponderosa Dr', city:'Parker', state:'CO', category:'carwash', type:'Express', phone:'(888) 772-2792' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7765,39.5022] }, properties:{ name:"Richie's Express Carwash", address:'9996 Twenty Mile Rd', city:'Parker', state:'CO', category:'carwash', type:'Express', phone:'(303) 840-1696', hours:'Mon–Sat 7am–6pm · Sun 8am–5pm' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7614,39.5009] }, properties:{ name:'Super Star Car Wash', address:'11375 S Parker Rd', city:'Parker', state:'CO', category:'carwash', type:'Express', phone:'(623) 536-5956', hours:'Daily 7am–8pm' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7430,39.5065] }, properties:{ name:'Wash N Go Carwash', address:'10159 Parkglenn Way', city:'Parker', state:'CO', category:'carwash', type:'Express', phone:'(720) 637-3637' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7570,39.5031] }, properties:{ name:'Waterway Carwash', address:'12055 Lioness Way', city:'Parker', state:'CO', category:'carwash', type:'Full-Service', phone:'(303) 925-8500' } },
    ],
  },
  ev: {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7594,39.5138] }, properties:{ name:'PACE Garage — ChargePoint', address:'20120 E. Mainstreet', city:'Parker', state:'CO', category:'ev', network:'ChargePoint', ports:10, level:'Level 2', free:'No (metered)' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7558,39.5122] }, properties:{ name:'King Soopers Parker — EVgo', address:'11860 Pine Dr', city:'Parker', state:'CO', category:'ev', network:'EVgo', ports:4, level:'DC Fast Charge', free:'No' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7480,39.5100] }, properties:{ name:'Target Parker — Tesla Supercharger', address:'10460 Dransfeldt Rd', city:'Parker', state:'CO', category:'ev', network:'Tesla Supercharger', ports:6, level:'DC Fast Charge', free:'Tesla only' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7630,39.5155] }, properties:{ name:'Parker Town Hall — ChargePoint', address:'20120 Mainstreet', city:'Parker', state:'CO', category:'ev', network:'ChargePoint', ports:2, level:'Level 2', free:'Yes (public)' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7700,39.5040] }, properties:{ name:'Walmart Parker — Tesla Supercharger', address:'16950 Lincoln Ave', city:'Parker', state:'CO', category:'ev', network:'Tesla Supercharger', ports:4, level:'DC Fast Charge', free:'Tesla only' } },
    ],
  },
  gas: {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7621,39.5169] }, properties:{ name:'King Soopers Fuel Center', address:'11020 S Parker Rd', city:'Parker', state:'CO', category:'gas', type:'Fuel', hours:'6:00–22:00', notes:'Loyalty discount with store card. Air and water on the south island.' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7702,39.5241] }, properties:{ name:'Costco Gasoline Parker', address:'11330 S Parker Rd', city:'Parker', state:'CO', category:'gas', type:'Members only', hours:'6:00–21:30', notes:'Membership required. Queues form before 8:00 on weekends.' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7548,39.5093] }, properties:{ name:'Conoco Mainstreet', address:'19565 E Mainstreet', city:'Parker', state:'CO', category:'gas', type:'Fuel · Diesel', hours:'24 hours', notes:'Diesel on the outer island. Attached convenience store.' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7810,39.5155] }, properties:{ name:'7-Eleven Pine Dr', address:'10471 S Parker Rd', city:'Parker', state:'CO', category:'gas', type:'Fuel', hours:'24 hours' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7461,39.5304] }, properties:{ name:'Murphy Express', address:'11402 Lincoln Ave', city:'Parker', state:'CO', category:'gas', type:'Fuel', hours:'5:00–23:00', notes:'Usually the cheapest regular in town.' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7885,39.5021] }, properties:{ name:'Shell Hess Rd', address:'19499 Hess Rd', city:'Parker', state:'CO', category:'gas', type:'Fuel · Diesel', hours:'24 hours', notes:'Truck-friendly approach from the west.' } },
    ],
  },
  auto: {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7625,39.4995] }, properties:{ name:'Jiffy Lube Parker', address:'10201 S Parker Rd', city:'Parker', state:'CO', category:'auto', type:'Oil Change', phone:'(720) 851-0012', hours:'Mon–Sat 8am–6pm' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7619,39.5005] }, properties:{ name:'Firestone Complete Auto Care', address:'10260 S Parker Rd', city:'Parker', state:'CO', category:'auto', type:'Full Service', phone:'(720) 851-2300', hours:'Mon–Fri 7am–7pm · Sat 7am–6pm' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7605,39.5015] }, properties:{ name:'Discount Tire Parker', address:'10310 S Parker Rd', city:'Parker', state:'CO', category:'auto', type:'Tires', phone:'(720) 851-0200', hours:'Mon–Fri 8am–6pm · Sat 8am–5pm' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7612,39.5025] }, properties:{ name:"O'Reilly Auto Parts", address:'10350 S Parker Rd', city:'Parker', state:'CO', category:'auto', type:'Auto Parts', phone:'(720) 851-0450', hours:'Daily 7:30am–9pm' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7590,39.5045] }, properties:{ name:'Goodyear Auto Service', address:'11200 S Parker Rd', city:'Parker', state:'CO', category:'auto', type:'Full Service', phone:'(303) 841-1150', hours:'Mon–Sat 7am–6pm' } },
      { type:'Feature', geometry:{ type:'Point', coordinates:[-104.7560,39.5060] }, properties:{ name:'Christian Brothers Automotive', address:'11565 S Parker Rd', city:'Parker', state:'CO', category:'auto', type:'Full Service', phone:'(720) 851-9000', hours:'Mon–Fri 7am–6pm' } },
    ],
  },
}