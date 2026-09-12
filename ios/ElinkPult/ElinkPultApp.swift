import SwiftUI
import UIKit
import UserNotifications

/// Zadnji token uređaja koji je Apple dodijelio; šalje se poslužitelju čim
/// postoji prijava (može stići i prije nego se korisnik prijavi).
@MainActor
final class Push: ObservableObject {
    static let shared = Push()
    @Published var tokenUredaja: String?
    @Published var dopusteno = false

    func zatraziDopustenje() async {
        let centar = UNUserNotificationCenter.current()
        let odobreno = (try? await centar.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        dopusteno = odobreno
        if odobreno { UIApplication.shared.registerForRemoteNotifications() }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in Push.shared.tokenUredaja = token }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Registracija za push nije uspjela: \(error.localizedDescription)")
    }

    /// Prikaži obavijest i kad je aplikacija otvorena.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }
}

@main
struct ElinkPultApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var api = API()
    @StateObject private var push = Push.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(api)
                .environmentObject(push)
                .tint(Boja.akcent)
        }
    }
}
