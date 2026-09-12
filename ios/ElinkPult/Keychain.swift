import Foundation
import Security

/// Token prijave čuva se u Keychainu, ne u UserDefaults — preživi ponovnu
/// instalaciju postavki i nije čitljiv iz sigurnosne kopije uređaja.
enum Keychain {
    private static let service = "hr.elink.pult"

    static func spremi(_ value: String, kljuc: String) {
        obrisi(kljuc: kljuc)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: kljuc,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func procitaj(kljuc: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: kljuc,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func obrisi(kljuc: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: kljuc
        ]
        SecItemDelete(query as CFDictionary)
    }
}
