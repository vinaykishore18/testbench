# Switch reset rig — build plan

Plug a console in, press one button, walk away. It formats itself, runs through
first-time setup, and comes back ready to sell.

At 20+ consoles a week and roughly six minutes of menu navigation each, that is
about two hours a week of somebody standing there pressing A.

---

## 1. Why it has to work this way

A Switch has no data interface. Plug one into a PC and nothing happens — no mass
storage, no ADB, no protocol. Nintendo never exposed one, so there is no Blancco
equivalent and there never will be.

There is an exploit route. Do not take it: it only works on unpatched 2017 and
early-2018 units (no Lite, no OLED, no Switch 2), Nintendo bans consoles it
detects, it can brick a unit, and it destroys the resale value of the exact stock
you are trying to sell.

So the rig does what a person does — **looks at the screen and presses buttons** —
just faster and without getting bored. Nothing is bypassed, nothing is modified,
no warranty is touched.

```
   Switch in dock
        │ HDMI out
        ▼
   USB capture card ──USB──► PC   (sees the console's screen as a webcam)
                              │
                              │ USB
                              ▼
                       USB-TTL adapter
                              │ UART (2 wires)
                              ▼
                      Raspberry Pi Pico ──USB──► dock's USB port
                      (pretends to be a controller)
```

The PC watches the screen through the capture card and sends button presses to
the Pico, which the console believes is a wired controller.

---

## 2. Parts

| Part | Why | Approx AUD |
|---|---|---|
| USB HDMI capture card, UVC, 1080p | PC sees the console screen as a webcam. Must say **UVC** or "driver-free" | $20–35 |
| Raspberry Pi Pico (RP2040) | Emulates the controller. Native USB, well documented | $7 |
| USB-TTL serial adapter (CH340 or FTDI) | How the PC talks to the Pico while its USB is busy pretending to be a controller | $5 |
| Jumper wires, 3 off | TX, RX, GND | $3 |
| HDMI cable, USB-C cable | Probably already on the bench | — |
| **Total** | | **≈ $40–50** |

Buy two capture cards. They are the flakiest part and the cheap ones die.

### The one trick that makes this possible

A real Pro Controller over USB does an authentication handshake with the console,
and you cannot fake it. But the Switch also accepts **licensed third-party wired
pads** with no handshake at all. So the Pico presents itself as a **HORI Pokken
Tournament DX Pro Pad** — vendor `0x0F0D`, product `0x0092` — and the console
takes it as a wired controller without argument.

This is the basis of every Switch controller-automation project out there. It is
also why the Pico's own USB port must go to the console, not the PC — hence the
separate serial adapter.

### Wiring

```
Pico GP0 (UART0 TX) ──► USB-TTL RX
Pico GP1 (UART0 RX) ──► USB-TTL TX
Pico GND            ──► USB-TTL GND
Pico USB            ──► dock USB port
USB-TTL USB         ──► PC
```

Do not connect the Pico's 3V3 or VBUS to the adapter. It is powered from the dock.

---

## 3. Software

Python on the bench PC. Four pieces:

**`capture.py`** — grabs frames from the capture card with OpenCV. One job:
hand back the current screen as an image.

**`pad.py`** — sends button commands down the serial line. `press("A")`,
`hold("DOWN", 0.4)`, `stick("L", x, y)`. Every press is logged with a timestamp.

**`screens.py`** — decides what the console is showing. Template matching
(`cv2.matchTemplate`) against small PNG crops kept in a `templates/` folder.
Not OCR — the Switch UI is high contrast and identical every time, so matching a
40×40 crop of the settings gear is far more reliable than reading text. OCR is
used for exactly one thing: reading the system version string.

**`procedures.py`** — the state machines. Each step is *see this screen, press
that button, wait for the next screen*. Never a blind timed sequence — if the
expected screen does not appear within a timeout, it stops and shouts.

### Firmware on the Pico

CircuitPython with the HID gamepad descriptor set to the HORI report format, or
C with TinyUSB if you want it tighter. Reads a byte or two off UART, sets the
button/stick state, holds it for the requested time, releases. Under 200 lines.

---

## 4. The actual workflow

This is the order the bench already works in, and the rig follows it exactly:

```
  console arrives
        │
        ▼
  1. FIRST-TIME SETUP   language, region, EULA, WiFi, timezone, TV, user
        │                ~4-5 minutes by hand — this is where the time goes
        ▼
  2. STICK DRIFT CHECK  Settings -> Controllers and Sensors -> Calibrate Control Sticks
        │                ~30 seconds
        ├──── drift found ────► STOP. Flag it. Do not format.
        ▼
  3. FORMAT             Settings -> System -> Formatting Options -> Initialise
        │                ~40 seconds, about six button presses
        ▼
  console reboots to the language screen, ready to sell
```

The format is the *last* step and it is the easy one. Setup is first, it is
mandatory — you cannot test a console you cannot get into — and it eats four of
the six minutes.

### A — First-time setup

Language, region, EULA, internet, time zone, TV or handheld, user creation, skip
parental controls.

Most of it is a few D-pad presses. The only genuinely hard part is the on-screen
keyboard, because every character is a navigation puzzle. Two decisions make that
problem almost disappear:

**Make the bench access point an open network with no password.** The Switch joins
an open network without typing anything at all, which removes the single hardest
piece of the whole project. Put it on a guest network isolated from the shop LAN
so it only reaches the internet. This is worth doing before anything else — it is
a five-minute change to a router that saves ten hours of coding.

**Use a one-character nickname.** The Switch only needs a single character, so use
`a`. One key press on the on-screen keyboard instead of navigating a word. The
buyer makes their own user anyway.

With those two in place the keyboard work drops to a single keystroke, and setup
becomes a straight run of menu presses.

If you would rather keep the AP secured, the keyboard is still solvable — the
layout never moves, so a lookup table of *(from key, to key) → movements* handles
it — but it is roughly a day of extra work for no benefit on a bench network.

### B — Stick drift check

**System Settings → Controllers and Sensors → Calibrate Control Sticks.** That
screen draws the live stick position as a dot inside a square.

The rig reads that dot straight off the capture card. Find the square with template
matching, find the dot inside it, measure its offset from centre in pixels, convert
to a percentage of the square. Hands off the console, a healthy stick puts the dot
dead centre; a drifting one sits visibly off, and pixels measure that far more
consistently than an eye does at the end of a shift.

Set the threshold against a console you know is good, the same way as the earbud
fingerprint. Then:

- **Dot centred** → carry on to the format
- **Dot off centre** → stop, screenshot it, flag the console, leave it unformatted

That branch matters. A console going for stick repair should not be wiped on its
way out the door, and a rig that formats everything regardless is worse than no rig.

Worth knowing: this tests the sticks *through the console*, which is what you want
for a complete unit. For loose Joy-Cons, or when a result looks borderline, the
Joy-Con page on the website reads the raw values over USB and is far more precise —
it can also tell you whether someone recalibrated the controller to hide the drift,
which the console's own screen cannot.

### C — Format

From HOME: System Settings → System → Formatting Options → Initialise Console, then
work through the confirmation dialogs and wait for the reboot.

The rig confirms success by checking the console has come back to the language
select screen. That closes the loop — you know it formatted rather than hoping.

Two consoles will stop it, and both need a person:

- **Parental controls PIN.** Formatting Options asks for it and the rig cannot
  guess. Detect the PIN screen, stop, flag for manual handling.
- **A linked Nintendo Account.** Formatting wipes the console but does *not*
  deregister it from Nintendo's servers. That is a web job on the seller's account.

## 5. Safety

This thing formats consoles. Design accordingly.

- **Never press the final Initialise unless the confirmation screen matches above
  0.9 confidence.** No match, no press.
- **Human confirmation before the destructive phase.** The operator sees a live
  frame from the capture card and presses a key. The rig does not decide on its own
  that a console is ready to wipe.
- **Screenshot at every decision point**, saved with the run log. When something
  goes wrong at 4pm on a Friday you will want to see what the screen actually said.
- **Abort on anything unexpected.** Wrong screen, timeout, unknown dialog — stop
  and wait for a person. Never guess.
- **Spacebar kills it.** And pulling the Pico's USB cable stops all input instantly,
  which is the physical backstop.

---

## 6. Build it in phases

I had this backwards in the first draft. Automating the format first saves about
forty seconds per console — thirteen minutes a week. It is not the prize. **Setup
is the prize**, at four to five minutes each.

**Milestone 0 — prove the hardware.** Half a day. Get the Pico accepted as a
controller and the capture card giving clean frames, then script the format
sequence. Not for the time saving — it is six presses and the simplest possible
script, which makes it the ideal smoke test for capture, controller emulation and
template matching all at once. If format works end to end, the hard risks are gone.

**Phase 1 — first-time setup.** The real one. Language through user creation.
With an open bench AP and a one-character nickname this is about 10 hours rather
than the 20 it would be with a password to type. This is where your 90 minutes a
week comes back.

**Phase 2 — stick drift reading.** Find the dot, measure the offset, branch on the
result. 6–8 hours, most of it calibrating the threshold against known-good consoles.

**Phase 3 — chain it.** Setup, test, decide, format or flag, with a screenshot log
per console. 4–6 hours.

Roughly 25–30 hours all in, given the open-AP decision. Without it, add a day.

## 7. What it costs and what it saves

Six minutes per console, 20 consoles a week, is two hours weekly — and about
ninety minutes of that is first-time setup alone.

The rig runs unattended, so that time comes back whole. Against roughly 25–30
hours of build, it pays for itself in about four months of labour — but the real
return is that it runs while you do something else, and it is consistent in a way
a tired person at 5pm is not.

The hardware is $40. The real cost is your time, which is why setup comes first
and the open access point comes before that.

---

## 8. What will break, honestly

**Firmware updates move menus.** The single biggest maintenance cost. Mitigate it
with a "learn this screen" mode — point the tool at a screen, drag a box, save the
crop. Re-teaching a moved menu should be a 30-second job, not a code change.

**Cheap capture cards die**, drop frames, or change their exposure. Buy two, and
have the software fail loudly rather than matching against a garbage frame.

**Language and region change everything.** Lock the bench to one language. If a
console arrives in another, set it manually before running the rig.

**Consoles arrive in unknown states** — mid-update, low battery, PIN locked, or a
dead dock. Phase 1 should begin by confirming it is at the HOME menu and bail out
politely if it is not.

---

## 9. What to do next

1. **Set up the open bench access point today.** It costs five minutes and it is
   the single biggest saving in the whole project. Guest network, isolated from the
   shop LAN, short name, no password.
2. Order the parts. Two capture cards, one Pico, one serial adapter.
3. When the hardware lands: flash the Pico, confirm the console accepts it as a
   controller, confirm the capture card gives a clean frame, and script the format
   sequence as a smoke test. Those two things working is the whole risk of the
   project — everything after is just software.
4. Then phase 1, which is setup, because that is where the time is.
