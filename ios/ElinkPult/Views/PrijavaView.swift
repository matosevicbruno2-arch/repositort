import AuthenticationServices
import SwiftUI
import UIKit

struct PrijavaView: View {
    @EnvironmentObject var api: API
    @State private var greska: String?
    @State private var uTijeku = false
    @State private var adresa = ""

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            VStack(spacing: 4) {
                Text("Elink ICT").font(.largeTitle.weight(.bold))
                Text("poslovi · naplata · inbox").font(.subheadline).foregroundStyle(Boja.tekst2)
            }

            Text("Pult čita podatke iz tvoje Google tablice, Gmaila i Kalendara.")
                .font(.callout)
                .foregroundStyle(Boja.tekst2)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            VStack(alignment: .leading, spacing: 6) {
                Text("Adresa poslužitelja").font(.caption).foregroundStyle(Boja.tekst2)
                TextField("https://pult.example.com", text: $adresa)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .onChange(of: adresa) { _, novo in api.adresa = novo }
            }
            .padding(.horizontal, 24)

            if let greska {
                Text(greska)
                    .font(.footnote)
                    .foregroundStyle(Boja.kriticno)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            Button {
                prijavi()
            } label: {
                HStack {
                    if uTijeku { ProgressView().tint(.white) }
                    Text("Prijavi se Google računom").fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .disabled(uTijeku || !api.adresaIspravna)
            .padding(.horizontal, 24)

            Spacer()
        }
        .background(Boja.pozadina)
        .onAppear { adresa = api.adresa }
    }

    private func prijavi() {
        guard let url = api.adresaPrijave else {
            greska = "Adresa poslužitelja nije ispravna."
            return
        }
        greska = nil
        uTijeku = true

        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "elinkpult") { povratni, error in
            uTijeku = false
            if let error {
                // Korisnik je zatvorio prozor — nije greška vrijedna prikaza.
                if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { return }
                greska = error.localizedDescription
                return
            }
            guard let povratni,
                  let dijelovi = URLComponents(url: povratni, resolvingAgainstBaseURL: false) else {
                greska = "Prijava nije vratila token."
                return
            }
            if let token = dijelovi.queryItems?.first(where: { $0.name == "token" })?.value {
                api.spremiToken(token)
            } else {
                let razlog = dijelovi.queryItems?.first(where: { $0.name == "greska" })?.value
                greska = Self.poruka(razlog)
            }
        }
        session.presentationContextProvider = Kontekst.shared
        session.prefersEphemeralWebBrowserSession = false // treba kolačić sesije za provjeru stanja
        session.start()
    }

    private static func poruka(_ razlog: String?) -> String {
        switch razlog {
        case "zabranjena": return "Taj Google račun nema pristup ovom pultu."
        case "odbijena": return "Prijava je prekinuta."
        case "neispravna": return "Prijava nije uspjela. Pokušaj ponovno."
        case "bez_tokena": return "Google nije vratio trajni pristup. Pokušaj ponovno."
        default: return "Prijava nije uspjela."
        }
    }
}

/// ASWebAuthenticationSession traži prozor u kojem će se prikazati.
final class Kontekst: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = Kontekst()

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first ?? ASPresentationAnchor()
    }
}
