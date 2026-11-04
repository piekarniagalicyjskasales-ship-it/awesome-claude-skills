'use strict';
// Walidacja konfiguracji (zmienne środowiskowe i opcje start()).
class ConfigError extends Error {}

function envNumber(name, { min = 1, integer = false, def } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n)))
    throw new ConfigError(`Nieprawidłowa wartość ${name}="${raw}": wymagana liczba ${integer ? 'całkowita ' : ''}>= ${min}`);
  return n;
}

const REGISTRATION_MODES = ['open', 'code', 'closed'];

function resolveRegistration(option, optionCode) {
  const mode = option !== undefined ? option : (process.env.REGISTRATION || 'open');
  if (!REGISTRATION_MODES.includes(mode))
    throw new ConfigError(`Nieprawidłowa wartość REGISTRATION="${mode}": dozwolone ${REGISTRATION_MODES.join(', ')}`);
  const code = optionCode !== undefined ? optionCode : (process.env.REGISTRATION_CODE || '');
  if (mode === 'code' && (typeof code !== 'string' || code.length < 8))
    throw new ConfigError('Tryb REGISTRATION=code wymaga ustawienia REGISTRATION_CODE (co najmniej 8 znaków). ' +
      'Ustaw zmienną REGISTRATION_CODE albo użyj REGISTRATION=open lub closed.');
  return { mode, code };
}

module.exports = { ConfigError, envNumber, resolveRegistration };
