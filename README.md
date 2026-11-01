# Torn Attack Page Hospital Timer with Latest Action

A userscript for [Torn City](https://www.torn.com) that makes the attack page more useful when your target is in hospital.

- Replaces **"This person is currently in hospital and cannot be attacked"** with a live countdown:

  > IN HOSPITAL
  > OUT IN 4:32

- Shows the target's **last action** (e.g. *Last action: 14 min ago (Offline)*). On PC it sits on the same line as the FairFight score from FF Scouter; in Torn PDA it goes on the line below.
- When the timer runs out, Torn's own page normally swaps in the **Start fight** button by itself. If it hasn't after a few seconds, the notice changes to a **Click to refresh** link.

Works in **Tampermonkey** (PC) and **Torn PDA** (Android / iOS).

## Install

### PC (Tampermonkey)

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Click this link: **[Install the script](https://raw.githubusercontent.com/tatzelbelm/torn-attack-page-hospital-timer-with-latest-action/main/torn-attack-page-hospital-timer-with-latest-action.user.js)**, then click **Install** in Tampermonkey.
3. Open any Torn attack page. Click the **Hosp Timer** pill in the bottom-left corner, paste your API key and press **Save**.

Tampermonkey checks for updates automatically.

### Torn PDA

1. In Torn PDA, open the userscripts manager in the settings.
2. Add a new script and paste in the contents of [`torn-attack-page-hospital-timer-with-latest-action.user.js`](torn-attack-page-hospital-timer-with-latest-action.user.js).
3. Make sure it runs on the attack pages (`torn.com/loader.php?sid=attack` and `torn.com/page.php?sid=attack`).

Torn PDA supplies your API key automatically, so there's no settings pill.

## API key

A **Public** access key is enough. The script only uses the `user -> profile` selection for the player you're attacking.

### Torn API Terms of Service

| Data Storage | Data Sharing | Purpose of Use | Key Storage & Sharing | Key Access Level |
|---|---|---|---|---|
| None. Data is only held in the open tab's memory. | Nobody. Requests go only to api.torn.com. | Show the target's hospital countdown and last action on the attack page (display only). | PC: saved in Tampermonkey's storage on your device. Torn PDA: supplied by the app. Only ever sent to api.torn.com. | Public |

## Torn scripting rules

The script only changes what's displayed. It makes no requests to Torn except through the official API, never reloads the page on its own, and never performs any game action. It calls the API once every 30 seconds while the tab is visible.

## Credits

Written by tatzelbelm, with help from Claude (AI).

## License

[MIT](LICENSE)
