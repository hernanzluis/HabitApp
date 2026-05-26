import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import 'react-native-url-polyfill/auto'

const supabaseUrl = 'https://uvsngemnftpysjvxslhu.supabase.co'
const supabaseAnonKey = 'sb_publishable_5szIB7W3P5G6XFFYyFjAfw_TwpKNFnp'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})