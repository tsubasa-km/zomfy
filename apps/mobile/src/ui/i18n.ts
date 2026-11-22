import { getLocales } from 'expo-localization'
import { createTranslator, languageFor } from '../lib/i18n'

export const language = languageFor(getLocales()[0]?.languageTag)

/** Translates a UI string (English is the key) into the phone's language. */
export const t = createTranslator(language)
