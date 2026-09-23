PlaceEcho iOS Demo
==================

Contents
--------
PlaceEcho.ipa is the installable iOS demo application.

Installation notes
------------------
This IPA is development-signed. It can be installed only on iPhones covered by
the provisioning profile used during export. The app requires a physical iPhone
because the bundled Insta360 SDK is device-only.

The build folder that produced this submission also retains
PlaceEcho-Demo.xcarchive. That archive is the Xcode master used to re-export or
re-sign the app; it is intentionally not duplicated inside this submission 7z.

X5 notes
--------
Open PlaceEcho on normal Wi-Fi, enter X5 capture, and manually connect the iPhone
to the X5 Wi-Fi when prompted by the capture flow. Personal Team signing cannot
use the Hotspot Configuration entitlement.
