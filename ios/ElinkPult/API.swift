import Foundation

/// Sloj prema poslužitelju pulta. Sve ide preko tokena iz Keychaina.
@MainActor
final class API: ObservableObject {
    static let kljucTokena = "app-token"
    static let kljucAdrese = "posluzitelj"

    @Published var adresa: String {
        didSet { UserDefaults.standard.set(adresa, forKey: Self.kljucAdrese) }
    }
    @Published private(set) var prijavljen: Bool

    private var token: String? {
        didSet { prijavljen = token != nil }
    }

    init() {
        let spremljena = UserDefaults.standard.string(forKey: Self.kljucAdrese) ?? ""
        adresa = spremljena
        let t = Keychain.procitaj(kljuc: Self.kljucTokena)
        token = t
        prijavljen = t != nil
    }

    var adresaIspravna: Bool { url("/zdravlje") != nil }

    private func url(_ path: String) -> URL? {
        let base = adresa.trimmingCharacters(in: .whitespaces).trimmingSuffix("/")
        guard !base.isEmpty, let u = URL(string: base + path), u.scheme != nil, u.host != nil else { return nil }
        return u
    }

    // MARK: Prijava

    var adresaPrijave: URL? { url("/auth/google?mode=app") }

    func spremiToken(_ noviToken: String) {
        Keychain.spremi(noviToken, kljuc: Self.kljucTokena)
        token = noviToken
    }

    func odjavi() async {
        if let u = url("/auth/odjava") {
            var req = URLRequest(url: u)
            req.httpMethod = "POST"
            if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            _ = try? await URLSession.shared.data(for: req)
        }
        Keychain.obrisi(kljuc: Self.kljucTokena)
        token = nil
    }

    // MARK: Zahtjevi

    private func zahtjev(_ path: String, metoda: String = "GET", tijelo: Data? = nil) throws -> URLRequest {
        guard let u = url(path) else { throw Greska.adresa }
        guard let token else { throw Greska.nijePrijavljen }
        var req = URLRequest(url: u)
        req.httpMethod = metoda
        req.timeoutInterval = 30
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let tijelo {
            req.httpBody = tijelo
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    private func posalji<T: Decodable>(_ req: URLRequest, kao: T.Type) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw Greska.mreza("Neočekivan odgovor.") }

        if http.statusCode >= 400 {
            if let apiError = try? JSONDecoder().decode(APIError.self, from: data) {
                if apiError.trebaPonovnaPrijava {
                    Keychain.obrisi(kljuc: Self.kljucTokena)
                    token = nil
                }
                throw Greska.posluzitelj(apiError.poruka)
            }
            throw Greska.posluzitelj("Greška \(http.statusCode).")
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw Greska.mreza("Odgovor poslužitelja nije razumljiv.")
        }
    }

    func dohvatiPult(osvjezi: Bool = false) async throws -> Pult {
        try await posalji(zahtjev("/api/pult" + (osvjezi ? "?refresh=1" : "")), kao: Envelope<Pult>.self).data
    }

    func dohvatiInbox(osvjezi: Bool = false) async throws -> [Poruka] {
        try await posalji(zahtjev("/api/inbox" + (osvjezi ? "?refresh=1" : "")), kao: Envelope<[Poruka]>.self).data
    }

    func dohvatiKalendar(osvjezi: Bool = false) async throws -> Kalendar {
        try await posalji(zahtjev("/api/kalendar" + (osvjezi ? "?refresh=1" : "")), kao: Envelope<Kalendar>.self).data
    }

    func upisiPosao(_ posao: NoviPosao) async throws -> UnosOdgovor {
        let tijelo = try JSONEncoder().encode(posao)
        return try await posalji(zahtjev("/api/posao", metoda: "POST", tijelo: tijelo), kao: Envelope<UnosOdgovor>.self).data
    }

    func registrirajUredaj(token deviceToken: String) async {
        struct Tijelo: Encodable { let token: String }
        guard let tijelo = try? JSONEncoder().encode(Tijelo(token: deviceToken)),
              let req = try? zahtjev("/api/uredjaj", metoda: "POST", tijelo: tijelo) else { return }
        _ = try? await URLSession.shared.data(for: req)
    }

    enum Greska: LocalizedError {
        case adresa
        case nijePrijavljen
        case posluzitelj(String)
        case mreza(String)

        var errorDescription: String? {
            switch self {
            case .adresa: return "Adresa poslužitelja nije ispravna. Provjeri je u Postavkama."
            case .nijePrijavljen: return "Prijava je potrebna."
            case .posluzitelj(let p): return p
            case .mreza(let p): return p
            }
        }
    }
}

private extension String {
    func trimmingSuffix(_ suffix: String) -> String {
        var s = self
        while s.hasSuffix(suffix) { s.removeLast(suffix.count) }
        return s
    }
}
