/**
 * Clearly labeled demo timetable data. These simplified routes are not an
 * authoritative Indian Railways schedule; production imports replace them.
 */
export const stations = [
  ['NDLS', 'New Delhi', 'Delhi', 28.643, 77.219],
  ['CNB', 'Kanpur Central', 'Kanpur', 26.453, 80.352],
  ['LKO', 'Lucknow Charbagh', 'Lucknow', 26.832, 80.925],
  ['PRYJ', 'Prayagraj Junction', 'Prayagraj', 25.436, 81.847],
  ['BSB', 'Varanasi Junction', 'Varanasi', 25.317, 82.974],
  ['HWH', 'Howrah Junction', 'Kolkata', 22.583, 88.342],
  ['GAYA', 'Gaya Junction', 'Gaya', 24.796, 84.999],
  ['BPL', 'Bhopal Junction', 'Bhopal', 23.268, 77.413],
  ['NGP', 'Nagpur Junction', 'Nagpur', 21.151, 79.088],
  ['CSTM', 'Mumbai CSMT', 'Mumbai', 18.94, 72.835],
  ['PUNE', 'Pune Junction', 'Pune', 18.528, 73.874],
  ['ADI', 'Ahmedabad Junction', 'Ahmedabad', 23.027, 72.601],
  ['JP', 'Jaipur Junction', 'Jaipur', 26.92, 75.788],
  ['AGC', 'Agra Cantt', 'Agra', 27.158, 77.991],
  ['MAS', 'Chennai Central', 'Chennai', 13.083, 80.275],
  ['BNC', 'Bengaluru Cantt', 'Bengaluru', 12.991, 77.598],
  ['SBC', 'KSR Bengaluru', 'Bengaluru', 12.978, 77.569],
  ['HYB', 'Hyderabad Deccan', 'Hyderabad', 17.385, 78.487],
  ['VSKP', 'Visakhapatnam', 'Visakhapatnam', 17.686, 83.218],
  ['TVC', 'Thiruvananthapuram Central', 'Thiruvananthapuram', 8.487, 76.953],
  ['ERS', 'Ernakulam Junction', 'Kochi', 9.969, 76.291],
  ['ASR', 'Amritsar Junction', 'Amritsar', 31.633, 74.872],
  ['JAT', 'Jammu Tawi', 'Jammu', 32.706, 74.879],
] as const;

type Stop = readonly [string, number, number, number]; // code, arrival minute, day, cumulative km
type TrainFixture = {
  number: string;
  name: string;
  type: string;
  superfast: boolean;
  stops: readonly Stop[];
};
const route = (...codes: string[]): Stop[] => {
  let distance = 0;
  return codes.map((code, index) => {
    if (index > 0) distance += 180 + ((index * 37) % 170);
    const minutes = 6 * 60 + index * 195;
    return [code, minutes % 1440, Math.floor(minutes / 1440), distance];
  });
};

export const trains: TrainFixture[] = [
  {
    number: '12002',
    name: 'Bhopal Shatabdi',
    type: 'SHATABDI',
    superfast: true,
    stops: route('NDLS', 'AGC', 'BPL'),
  },
  {
    number: '12009',
    name: 'Mumbai Shatabdi',
    type: 'SHATABDI',
    superfast: true,
    stops: route('CSTM', 'PUNE', 'ADI'),
  },
  {
    number: '12027',
    name: 'Chennai Shatabdi',
    type: 'SHATABDI',
    superfast: true,
    stops: route('MAS', 'BNC', 'SBC'),
  },
  {
    number: '12019',
    name: 'Howrah Shatabdi',
    type: 'SHATABDI',
    superfast: true,
    stops: route('HWH', 'GAYA', 'BSB', 'NDLS'),
  },
  {
    number: '12023',
    name: 'Howrah Jan Shatabdi',
    type: 'JAN_SHATABDI',
    superfast: true,
    stops: route('HWH', 'GAYA', 'BSB', 'LKO'),
  },
  {
    number: '12951',
    name: 'Mumbai Rajdhani',
    type: 'RAJDHANI',
    superfast: true,
    stops: route('NDLS', 'AGC', 'BPL', 'CSTM'),
  },
  {
    number: '12301',
    name: 'Howrah Rajdhani',
    type: 'RAJDHANI',
    superfast: true,
    stops: route('NDLS', 'CNB', 'PRYJ', 'GAYA', 'HWH'),
  },
  {
    number: '12424',
    name: 'Dibrugarh Rajdhani',
    type: 'RAJDHANI',
    superfast: true,
    stops: route('NDLS', 'CNB', 'BSB', 'HWH'),
  },
  {
    number: '12627',
    name: 'Karnataka Express',
    type: 'EXPRESS',
    superfast: true,
    stops: route('NDLS', 'AGC', 'BPL', 'NGP', 'SBC'),
  },
  {
    number: '12616',
    name: 'Grand Trunk Express',
    type: 'EXPRESS',
    superfast: true,
    stops: route('NDLS', 'AGC', 'BPL', 'NGP', 'MAS'),
  },
  {
    number: '12903',
    name: 'Golden Temple Mail',
    type: 'EXPRESS',
    superfast: true,
    stops: route('ASR', 'NDLS', 'AGC', 'CSTM'),
  },
  {
    number: '12925',
    name: 'Paschim Express',
    type: 'EXPRESS',
    superfast: true,
    stops: route('ASR', 'NDLS', 'JP', 'CSTM'),
  },
  {
    number: '12723',
    name: 'Telangana Express',
    type: 'EXPRESS',
    superfast: true,
    stops: route('NDLS', 'AGC', 'BPL', 'NGP', 'HYB'),
  },
  {
    number: '12649',
    name: 'Karnataka Sampark Kranti',
    type: 'EXPRESS',
    superfast: true,
    stops: route('NDLS', 'JP', 'ADI', 'PUNE', 'SBC'),
  },
  {
    number: '12625',
    name: 'Kerala Express',
    type: 'EXPRESS',
    superfast: true,
    stops: route('NDLS', 'AGC', 'BPL', 'NGP', 'ERS', 'TVC'),
  },
];

export const fareRules = [
  {
    classCode: 'SL',
    perKmPaise: 35,
    basePaise: 3000,
    reservationFeePaise: 2000,
    superfastFeePaise: 1500,
  },
  {
    classCode: '3A',
    perKmPaise: 125,
    basePaise: 15000,
    reservationFeePaise: 4000,
    superfastFeePaise: 4500,
  },
  {
    classCode: '2A',
    perKmPaise: 175,
    basePaise: 25000,
    reservationFeePaise: 5000,
    superfastFeePaise: 4500,
  },
  {
    classCode: 'CC',
    perKmPaise: 95,
    basePaise: 10000,
    reservationFeePaise: 3000,
    superfastFeePaise: 3000,
  },
] as const;

export function fixtureStops(train: TrainFixture) {
  return train.stops.map(([stationCode, minute, dayOffset, distanceKm], stopIdx) => {
    const hhmm = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return {
      trainNumber: train.number,
      stopIdx,
      stationCode,
      arrival: stopIdx === 0 ? null : hhmm(minute),
      departure: stopIdx === train.stops.length - 1 ? null : hhmm(minute + 5),
      dayOffset,
      distanceKm,
    };
  });
}
