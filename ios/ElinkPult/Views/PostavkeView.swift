import SwiftUI

struct PostavkeView: View {
    @EnvironmentObject var api: API
    @EnvironmentObject var push: Push
    @State private var adresa = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Poslužitelj") {
                    TextField("https://pult.example.com", text: $adresa)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .onChange(of: adresa) { _, novo in api.adresa = novo }
                }

                Section("Obavijesti") {
                    HStack {
                        Text("Dopuštenje")
                        Spacer()
                        Text(push.dopusteno ? "odobreno" : "nije odobreno")
                            .foregroundStyle(push.dopusteno ? Boja.dobro : Boja.tekst2)
                    }
                    HStack {
                        Text("Uređaj registriran")
                        Spacer()
                        Text(push.tokenUredaja == nil ? "ne" : "da")
                            .foregroundStyle(push.tokenUredaja == nil ? Boja.tekst2 : Boja.dobro)
                    }
                    if !push.dopusteno {
                        Button("Zatraži dopuštenje") {
                            Task { await push.zatraziDopustenje() }
                        }
                    }
                } footer: {
                    Text("Obavijesti stižu kad račun prođe rok plaćanja i kad posao ima rok danas ili sutra.")
                }

                Section {
                    Button("Odjavi se", role: .destructive) {
                        Task { await api.odjavi() }
                    }
                }
            }
            .navigationTitle("Postavke")
        }
        .onAppear { adresa = api.adresa }
    }
}
