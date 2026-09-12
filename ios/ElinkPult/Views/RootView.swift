import SwiftUI

struct RootView: View {
    @EnvironmentObject var api: API
    @EnvironmentObject var push: Push

    var body: some View {
        Group {
            if api.prijavljen {
                TabView {
                    PultView()
                        .tabItem { Label("Pult", systemImage: "chart.bar.doc.horizontal") }
                    InboxView()
                        .tabItem { Label("Inbox", systemImage: "tray.full") }
                    KalendarView()
                        .tabItem { Label("Kalendar", systemImage: "calendar") }
                    PostavkeView()
                        .tabItem { Label("Postavke", systemImage: "gearshape") }
                }
            } else {
                PrijavaView()
            }
        }
        .task(id: api.prijavljen) {
            guard api.prijavljen else { return }
            await push.zatraziDopustenje()
        }
        // Token uređaja može stići prije prijave, pa se šalje kad su oba spremna.
        .task(id: PrijavaStanje(prijavljen: api.prijavljen, token: push.tokenUredaja)) {
            guard api.prijavljen, let token = push.tokenUredaja else { return }
            await api.registrirajUredaj(token: token)
        }
    }

    private struct PrijavaStanje: Equatable {
        let prijavljen: Bool
        let token: String?
    }
}
