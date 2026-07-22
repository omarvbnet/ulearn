/// International dialing codes for WhatsApp OTP login.
/// Default: Iraq (+964).
library;

class PhoneCountry {
  const PhoneCountry({
    required this.iso,
    required this.name,
    required this.dial,
    required this.flag,
  });

  final String iso;
  final String name;
  final String dial;
  final String flag;

  String get label => '$flag +$dial';
}

const kDefaultPhoneCountryIso = 'IQ';

const kPhoneCountries = <PhoneCountry>[
  PhoneCountry(iso: 'AF', name: 'Afghanistan', dial: '93', flag: '🇦🇫'),
  PhoneCountry(iso: 'AL', name: 'Albania', dial: '355', flag: '🇦🇱'),
  PhoneCountry(iso: 'DZ', name: 'Algeria', dial: '213', flag: '🇩🇿'),
  PhoneCountry(iso: 'AD', name: 'Andorra', dial: '376', flag: '🇦🇩'),
  PhoneCountry(iso: 'AO', name: 'Angola', dial: '244', flag: '🇦🇴'),
  PhoneCountry(iso: 'AR', name: 'Argentina', dial: '54', flag: '🇦🇷'),
  PhoneCountry(iso: 'AM', name: 'Armenia', dial: '374', flag: '🇦🇲'),
  PhoneCountry(iso: 'AU', name: 'Australia', dial: '61', flag: '🇦🇺'),
  PhoneCountry(iso: 'AT', name: 'Austria', dial: '43', flag: '🇦🇹'),
  PhoneCountry(iso: 'AZ', name: 'Azerbaijan', dial: '994', flag: '🇦🇿'),
  PhoneCountry(iso: 'BH', name: 'Bahrain', dial: '973', flag: '🇧🇭'),
  PhoneCountry(iso: 'BD', name: 'Bangladesh', dial: '880', flag: '🇧🇩'),
  PhoneCountry(iso: 'BY', name: 'Belarus', dial: '375', flag: '🇧🇾'),
  PhoneCountry(iso: 'BE', name: 'Belgium', dial: '32', flag: '🇧🇪'),
  PhoneCountry(iso: 'BZ', name: 'Belize', dial: '501', flag: '🇧🇿'),
  PhoneCountry(iso: 'BJ', name: 'Benin', dial: '229', flag: '🇧🇯'),
  PhoneCountry(iso: 'BT', name: 'Bhutan', dial: '975', flag: '🇧🇹'),
  PhoneCountry(iso: 'BO', name: 'Bolivia', dial: '591', flag: '🇧🇴'),
  PhoneCountry(iso: 'BA', name: 'Bosnia', dial: '387', flag: '🇧🇦'),
  PhoneCountry(iso: 'BW', name: 'Botswana', dial: '267', flag: '🇧🇼'),
  PhoneCountry(iso: 'BR', name: 'Brazil', dial: '55', flag: '🇧🇷'),
  PhoneCountry(iso: 'BN', name: 'Brunei', dial: '673', flag: '🇧🇳'),
  PhoneCountry(iso: 'BG', name: 'Bulgaria', dial: '359', flag: '🇧🇬'),
  PhoneCountry(iso: 'BF', name: 'Burkina Faso', dial: '226', flag: '🇧🇫'),
  PhoneCountry(iso: 'BI', name: 'Burundi', dial: '257', flag: '🇧🇮'),
  PhoneCountry(iso: 'KH', name: 'Cambodia', dial: '855', flag: '🇰🇭'),
  PhoneCountry(iso: 'CM', name: 'Cameroon', dial: '237', flag: '🇨🇲'),
  PhoneCountry(iso: 'CA', name: 'Canada', dial: '1', flag: '🇨🇦'),
  PhoneCountry(iso: 'CV', name: 'Cape Verde', dial: '238', flag: '🇨🇻'),
  PhoneCountry(iso: 'CF', name: 'Central African Rep.', dial: '236', flag: '🇨🇫'),
  PhoneCountry(iso: 'TD', name: 'Chad', dial: '235', flag: '🇹🇩'),
  PhoneCountry(iso: 'CL', name: 'Chile', dial: '56', flag: '🇨🇱'),
  PhoneCountry(iso: 'CN', name: 'China', dial: '86', flag: '🇨🇳'),
  PhoneCountry(iso: 'CO', name: 'Colombia', dial: '57', flag: '🇨🇴'),
  PhoneCountry(iso: 'KM', name: 'Comoros', dial: '269', flag: '🇰🇲'),
  PhoneCountry(iso: 'CG', name: 'Congo', dial: '242', flag: '🇨🇬'),
  PhoneCountry(iso: 'CD', name: 'Congo (DRC)', dial: '243', flag: '🇨🇩'),
  PhoneCountry(iso: 'CR', name: 'Costa Rica', dial: '506', flag: '🇨🇷'),
  PhoneCountry(iso: 'CI', name: 'Côte d\'Ivoire', dial: '225', flag: '🇨🇮'),
  PhoneCountry(iso: 'HR', name: 'Croatia', dial: '385', flag: '🇭🇷'),
  PhoneCountry(iso: 'CU', name: 'Cuba', dial: '53', flag: '🇨🇺'),
  PhoneCountry(iso: 'CY', name: 'Cyprus', dial: '357', flag: '🇨🇾'),
  PhoneCountry(iso: 'CZ', name: 'Czechia', dial: '420', flag: '🇨🇿'),
  PhoneCountry(iso: 'DK', name: 'Denmark', dial: '45', flag: '🇩🇰'),
  PhoneCountry(iso: 'DJ', name: 'Djibouti', dial: '253', flag: '🇩🇯'),
  PhoneCountry(iso: 'DO', name: 'Dominican Rep.', dial: '1', flag: '🇩🇴'),
  PhoneCountry(iso: 'EC', name: 'Ecuador', dial: '593', flag: '🇪🇨'),
  PhoneCountry(iso: 'EG', name: 'Egypt', dial: '20', flag: '🇪🇬'),
  PhoneCountry(iso: 'SV', name: 'El Salvador', dial: '503', flag: '🇸🇻'),
  PhoneCountry(iso: 'GQ', name: 'Equatorial Guinea', dial: '240', flag: '🇬🇶'),
  PhoneCountry(iso: 'ER', name: 'Eritrea', dial: '291', flag: '🇪🇷'),
  PhoneCountry(iso: 'EE', name: 'Estonia', dial: '372', flag: '🇪🇪'),
  PhoneCountry(iso: 'SZ', name: 'Eswatini', dial: '268', flag: '🇸🇿'),
  PhoneCountry(iso: 'ET', name: 'Ethiopia', dial: '251', flag: '🇪🇹'),
  PhoneCountry(iso: 'FJ', name: 'Fiji', dial: '679', flag: '🇫🇯'),
  PhoneCountry(iso: 'FI', name: 'Finland', dial: '358', flag: '🇫🇮'),
  PhoneCountry(iso: 'FR', name: 'France', dial: '33', flag: '🇫🇷'),
  PhoneCountry(iso: 'GA', name: 'Gabon', dial: '241', flag: '🇬🇦'),
  PhoneCountry(iso: 'GM', name: 'Gambia', dial: '220', flag: '🇬🇲'),
  PhoneCountry(iso: 'GE', name: 'Georgia', dial: '995', flag: '🇬🇪'),
  PhoneCountry(iso: 'DE', name: 'Germany', dial: '49', flag: '🇩🇪'),
  PhoneCountry(iso: 'GH', name: 'Ghana', dial: '233', flag: '🇬🇭'),
  PhoneCountry(iso: 'GR', name: 'Greece', dial: '30', flag: '🇬🇷'),
  PhoneCountry(iso: 'GT', name: 'Guatemala', dial: '502', flag: '🇬🇹'),
  PhoneCountry(iso: 'GN', name: 'Guinea', dial: '224', flag: '🇬🇳'),
  PhoneCountry(iso: 'GW', name: 'Guinea-Bissau', dial: '245', flag: '🇬🇼'),
  PhoneCountry(iso: 'GY', name: 'Guyana', dial: '592', flag: '🇬🇾'),
  PhoneCountry(iso: 'HT', name: 'Haiti', dial: '509', flag: '🇭🇹'),
  PhoneCountry(iso: 'HN', name: 'Honduras', dial: '504', flag: '🇭🇳'),
  PhoneCountry(iso: 'HK', name: 'Hong Kong', dial: '852', flag: '🇭🇰'),
  PhoneCountry(iso: 'HU', name: 'Hungary', dial: '36', flag: '🇭🇺'),
  PhoneCountry(iso: 'IS', name: 'Iceland', dial: '354', flag: '🇮🇸'),
  PhoneCountry(iso: 'IN', name: 'India', dial: '91', flag: '🇮🇳'),
  PhoneCountry(iso: 'ID', name: 'Indonesia', dial: '62', flag: '🇮🇩'),
  PhoneCountry(iso: 'IR', name: 'Iran', dial: '98', flag: '🇮🇷'),
  PhoneCountry(iso: 'IQ', name: 'Iraq', dial: '964', flag: '🇮🇶'),
  PhoneCountry(iso: 'IE', name: 'Ireland', dial: '353', flag: '🇮🇪'),
  PhoneCountry(iso: 'IL', name: 'Israel', dial: '972', flag: '🇮🇱'),
  PhoneCountry(iso: 'IT', name: 'Italy', dial: '39', flag: '🇮🇹'),
  PhoneCountry(iso: 'JM', name: 'Jamaica', dial: '1', flag: '🇯🇲'),
  PhoneCountry(iso: 'JP', name: 'Japan', dial: '81', flag: '🇯🇵'),
  PhoneCountry(iso: 'JO', name: 'Jordan', dial: '962', flag: '🇯🇴'),
  PhoneCountry(iso: 'KZ', name: 'Kazakhstan', dial: '7', flag: '🇰🇿'),
  PhoneCountry(iso: 'KE', name: 'Kenya', dial: '254', flag: '🇰🇪'),
  PhoneCountry(iso: 'KW', name: 'Kuwait', dial: '965', flag: '🇰🇼'),
  PhoneCountry(iso: 'KG', name: 'Kyrgyzstan', dial: '996', flag: '🇰🇬'),
  PhoneCountry(iso: 'LA', name: 'Laos', dial: '856', flag: '🇱🇦'),
  PhoneCountry(iso: 'LV', name: 'Latvia', dial: '371', flag: '🇱🇻'),
  PhoneCountry(iso: 'LB', name: 'Lebanon', dial: '961', flag: '🇱🇧'),
  PhoneCountry(iso: 'LS', name: 'Lesotho', dial: '266', flag: '🇱🇸'),
  PhoneCountry(iso: 'LR', name: 'Liberia', dial: '231', flag: '🇱🇷'),
  PhoneCountry(iso: 'LY', name: 'Libya', dial: '218', flag: '🇱🇾'),
  PhoneCountry(iso: 'LI', name: 'Liechtenstein', dial: '423', flag: '🇱🇮'),
  PhoneCountry(iso: 'LT', name: 'Lithuania', dial: '370', flag: '🇱🇹'),
  PhoneCountry(iso: 'LU', name: 'Luxembourg', dial: '352', flag: '🇱🇺'),
  PhoneCountry(iso: 'MO', name: 'Macau', dial: '853', flag: '🇲🇴'),
  PhoneCountry(iso: 'MG', name: 'Madagascar', dial: '261', flag: '🇲🇬'),
  PhoneCountry(iso: 'MW', name: 'Malawi', dial: '265', flag: '🇲🇼'),
  PhoneCountry(iso: 'MY', name: 'Malaysia', dial: '60', flag: '🇲🇾'),
  PhoneCountry(iso: 'MV', name: 'Maldives', dial: '960', flag: '🇲🇻'),
  PhoneCountry(iso: 'ML', name: 'Mali', dial: '223', flag: '🇲🇱'),
  PhoneCountry(iso: 'MT', name: 'Malta', dial: '356', flag: '🇲🇹'),
  PhoneCountry(iso: 'MR', name: 'Mauritania', dial: '222', flag: '🇲🇷'),
  PhoneCountry(iso: 'MU', name: 'Mauritius', dial: '230', flag: '🇲🇺'),
  PhoneCountry(iso: 'MX', name: 'Mexico', dial: '52', flag: '🇲🇽'),
  PhoneCountry(iso: 'MD', name: 'Moldova', dial: '373', flag: '🇲🇩'),
  PhoneCountry(iso: 'MC', name: 'Monaco', dial: '377', flag: '🇲🇨'),
  PhoneCountry(iso: 'MN', name: 'Mongolia', dial: '976', flag: '🇲🇳'),
  PhoneCountry(iso: 'ME', name: 'Montenegro', dial: '382', flag: '🇲🇪'),
  PhoneCountry(iso: 'MA', name: 'Morocco', dial: '212', flag: '🇲🇦'),
  PhoneCountry(iso: 'MZ', name: 'Mozambique', dial: '258', flag: '🇲🇿'),
  PhoneCountry(iso: 'MM', name: 'Myanmar', dial: '95', flag: '🇲🇲'),
  PhoneCountry(iso: 'NA', name: 'Namibia', dial: '264', flag: '🇳🇦'),
  PhoneCountry(iso: 'NP', name: 'Nepal', dial: '977', flag: '🇳🇵'),
  PhoneCountry(iso: 'NL', name: 'Netherlands', dial: '31', flag: '🇳🇱'),
  PhoneCountry(iso: 'NZ', name: 'New Zealand', dial: '64', flag: '🇳🇿'),
  PhoneCountry(iso: 'NI', name: 'Nicaragua', dial: '505', flag: '🇳🇮'),
  PhoneCountry(iso: 'NE', name: 'Niger', dial: '227', flag: '🇳🇪'),
  PhoneCountry(iso: 'NG', name: 'Nigeria', dial: '234', flag: '🇳🇬'),
  PhoneCountry(iso: 'KP', name: 'North Korea', dial: '850', flag: '🇰🇵'),
  PhoneCountry(iso: 'MK', name: 'North Macedonia', dial: '389', flag: '🇲🇰'),
  PhoneCountry(iso: 'NO', name: 'Norway', dial: '47', flag: '🇳🇴'),
  PhoneCountry(iso: 'OM', name: 'Oman', dial: '968', flag: '🇴🇲'),
  PhoneCountry(iso: 'PK', name: 'Pakistan', dial: '92', flag: '🇵🇰'),
  PhoneCountry(iso: 'PS', name: 'Palestine', dial: '970', flag: '🇵🇸'),
  PhoneCountry(iso: 'PA', name: 'Panama', dial: '507', flag: '🇵🇦'),
  PhoneCountry(iso: 'PG', name: 'Papua New Guinea', dial: '675', flag: '🇵🇬'),
  PhoneCountry(iso: 'PY', name: 'Paraguay', dial: '595', flag: '🇵🇾'),
  PhoneCountry(iso: 'PE', name: 'Peru', dial: '51', flag: '🇵🇪'),
  PhoneCountry(iso: 'PH', name: 'Philippines', dial: '63', flag: '🇵🇭'),
  PhoneCountry(iso: 'PL', name: 'Poland', dial: '48', flag: '🇵🇱'),
  PhoneCountry(iso: 'PT', name: 'Portugal', dial: '351', flag: '🇵🇹'),
  PhoneCountry(iso: 'QA', name: 'Qatar', dial: '974', flag: '🇶🇦'),
  PhoneCountry(iso: 'RO', name: 'Romania', dial: '40', flag: '🇷🇴'),
  PhoneCountry(iso: 'RU', name: 'Russia', dial: '7', flag: '🇷🇺'),
  PhoneCountry(iso: 'RW', name: 'Rwanda', dial: '250', flag: '🇷🇼'),
  PhoneCountry(iso: 'SA', name: 'Saudi Arabia', dial: '966', flag: '🇸🇦'),
  PhoneCountry(iso: 'SN', name: 'Senegal', dial: '221', flag: '🇸🇳'),
  PhoneCountry(iso: 'RS', name: 'Serbia', dial: '381', flag: '🇷🇸'),
  PhoneCountry(iso: 'SC', name: 'Seychelles', dial: '248', flag: '🇸🇨'),
  PhoneCountry(iso: 'SL', name: 'Sierra Leone', dial: '232', flag: '🇸🇱'),
  PhoneCountry(iso: 'SG', name: 'Singapore', dial: '65', flag: '🇸🇬'),
  PhoneCountry(iso: 'SK', name: 'Slovakia', dial: '421', flag: '🇸🇰'),
  PhoneCountry(iso: 'SI', name: 'Slovenia', dial: '386', flag: '🇸🇮'),
  PhoneCountry(iso: 'SO', name: 'Somalia', dial: '252', flag: '🇸🇴'),
  PhoneCountry(iso: 'ZA', name: 'South Africa', dial: '27', flag: '🇿🇦'),
  PhoneCountry(iso: 'KR', name: 'South Korea', dial: '82', flag: '🇰🇷'),
  PhoneCountry(iso: 'SS', name: 'South Sudan', dial: '211', flag: '🇸🇸'),
  PhoneCountry(iso: 'ES', name: 'Spain', dial: '34', flag: '🇪🇸'),
  PhoneCountry(iso: 'LK', name: 'Sri Lanka', dial: '94', flag: '🇱🇰'),
  PhoneCountry(iso: 'SD', name: 'Sudan', dial: '249', flag: '🇸🇩'),
  PhoneCountry(iso: 'SR', name: 'Suriname', dial: '597', flag: '🇸🇷'),
  PhoneCountry(iso: 'SE', name: 'Sweden', dial: '46', flag: '🇸🇪'),
  PhoneCountry(iso: 'CH', name: 'Switzerland', dial: '41', flag: '🇨🇭'),
  PhoneCountry(iso: 'SY', name: 'Syria', dial: '963', flag: '🇸🇾'),
  PhoneCountry(iso: 'TW', name: 'Taiwan', dial: '886', flag: '🇹🇼'),
  PhoneCountry(iso: 'TJ', name: 'Tajikistan', dial: '992', flag: '🇹🇯'),
  PhoneCountry(iso: 'TZ', name: 'Tanzania', dial: '255', flag: '🇹🇿'),
  PhoneCountry(iso: 'TH', name: 'Thailand', dial: '66', flag: '🇹🇭'),
  PhoneCountry(iso: 'TL', name: 'Timor-Leste', dial: '670', flag: '🇹🇱'),
  PhoneCountry(iso: 'TG', name: 'Togo', dial: '228', flag: '🇹🇬'),
  PhoneCountry(iso: 'TN', name: 'Tunisia', dial: '216', flag: '🇹🇳'),
  PhoneCountry(iso: 'TR', name: 'Turkey', dial: '90', flag: '🇹🇷'),
  PhoneCountry(iso: 'TM', name: 'Turkmenistan', dial: '993', flag: '🇹🇲'),
  PhoneCountry(iso: 'UG', name: 'Uganda', dial: '256', flag: '🇺🇬'),
  PhoneCountry(iso: 'UA', name: 'Ukraine', dial: '380', flag: '🇺🇦'),
  PhoneCountry(iso: 'AE', name: 'United Arab Emirates', dial: '971', flag: '🇦🇪'),
  PhoneCountry(iso: 'GB', name: 'United Kingdom', dial: '44', flag: '🇬🇧'),
  PhoneCountry(iso: 'US', name: 'United States', dial: '1', flag: '🇺🇸'),
  PhoneCountry(iso: 'UY', name: 'Uruguay', dial: '598', flag: '🇺🇾'),
  PhoneCountry(iso: 'UZ', name: 'Uzbekistan', dial: '998', flag: '🇺🇿'),
  PhoneCountry(iso: 'VE', name: 'Venezuela', dial: '58', flag: '🇻🇪'),
  PhoneCountry(iso: 'VN', name: 'Vietnam', dial: '84', flag: '🇻🇳'),
  PhoneCountry(iso: 'YE', name: 'Yemen', dial: '967', flag: '🇾🇪'),
  PhoneCountry(iso: 'ZM', name: 'Zambia', dial: '260', flag: '🇿🇲'),
  PhoneCountry(iso: 'ZW', name: 'Zimbabwe', dial: '263', flag: '🇿🇼'),
];

PhoneCountry getDefaultPhoneCountry() {
  return kPhoneCountries.firstWhere(
    (c) => c.iso == kDefaultPhoneCountryIso,
    orElse: () => kPhoneCountries.first,
  );
}

/// Build `+dial` + national, stripping a leading 0 from the national number.
String buildInternationalPhone(String dial, String nationalInput) {
  var national = nationalInput.replaceAll(RegExp(r'\D'), '');
  final dialDigits = dial.replaceAll(RegExp(r'\D'), '');
  if (national.startsWith('00')) {
    national = national.substring(2);
  }
  if (national.startsWith(dialDigits)) {
    return '+$national';
  }
  if (national.startsWith('0')) {
    national = national.substring(1);
  }
  return '+$dialDigits$national';
}

/// Iraq first, then A–Z by name.
List<PhoneCountry> phoneCountriesIraqFirst() {
  final iraq = getDefaultPhoneCountry();
  final rest = kPhoneCountries.where((c) => c.iso != iraq.iso).toList()
    ..sort((a, b) => a.name.compareTo(b.name));
  return [iraq, ...rest];
}
