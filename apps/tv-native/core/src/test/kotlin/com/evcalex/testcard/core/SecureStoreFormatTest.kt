package com.evcalex.testcard.core

import com.evcalex.testcard.core.adopt.openSecureStoreItem
import com.evcalex.testcard.core.adopt.secureStoreAlias
import com.evcalex.testcard.core.adopt.secureStoreKey
import com.evcalex.testcard.core.adopt.secureStoreReadable
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** An entry written the way expo-secure-store's AESEncryptor writes one (its source is in apps/mobile/node_modules) is opened, with the key that sealed it. */
class SecureStoreFormatTest {
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private fun seal(value: String, extra: String = """"usesKeystoreSuffix":true,"keystoreAlias":"key_v1","requireAuthentication":false"""): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
        val ct = Base64.getEncoder().encodeToString(cipher.doFinal(value.toByteArray()))
        val iv = Base64.getEncoder().encodeToString(cipher.iv)
        return """{"ct":"$ct","iv":"$iv","tlen":128,"scheme":"aes",$extra}"""
    }

    @Test fun `an entry opens to what was stored`() {
        val login = """{"baseUrl":"http://p:80","username":"u","password":"p w"}"""
        assertEquals(login, openSecureStoreItem(seal(login), key))
    }

    @Test fun `the key and alias are the ones the React Native app used`() {
        assertEquals("key_v1-testcard.account-password", secureStoreKey("testcard.account-password"))
        assertEquals("AES/GCM/NoPadding:key_v1:keystoreUnauthenticated", secureStoreAlias(seal("x")))
        assertEquals("AES/GCM/NoPadding:key_v1", secureStoreAlias(seal("x", """"scheme2":1""")))
    }

    @Test fun `an entry behind authentication or from the old hybrid scheme is not readable`() {
        assertTrue(secureStoreReadable(seal("x")))
        assertFalse(secureStoreReadable(seal("x", """"requireAuthentication":true""")))
        assertFalse(secureStoreReadable("""{"scheme":"hybrid"}"""))
    }
}
