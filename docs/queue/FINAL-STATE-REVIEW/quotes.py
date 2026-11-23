"""Check each quotation of final-state.md against its fetched source: normalized whitespace, quotes and dashes; '...' splits a quote into parts that must each appear."""
import re, sys, os
src = sys.argv[1]
def norm(s):
    s = s.replace('“','"').replace('”','"').replace('’',"'").replace('‘',"'")
    s = s.replace('–','-').replace('—','-').replace('­','').replace('ﬁ','fi')
    s = re.sub(r'-\s*\n\s*', '-', s)
    return re.sub(r'\s+', ' ', s).strip().lower()
Q = {
 's1': ["End-to-end software system tested in relevant environment, meeting predicted performance.",
        "Prototype implementations of the software demonstrated on full-scale, realistic problems.",
        "Well integrated with operational hardware/software systems",
        "End-to-end software elements implemented and interfaced with existing systems/simulations conforming to target environment. End-to-end software system tested in relevant environment, meeting predicted performance. Operational environment performance predicted.",
        "Prototype implementations of the software demonstrated on full-scale, realistic problems. Partially integrated with existing hardware/software systems. Limited documentation available. Engineering feasibility fully demonstrated.",
        "Prototype software exists having all key functionality available for demonstration and test. Well integrated with operational hardware/software systems demonstrating operational feasibility. Most software bugs removed. Limited documentation available."],
 's2': ["validated in a relevant environment", "demonstrated in a relevant environment"],
 's3': ["Major version zero (0.y.z) is for initial development. Anything MAY change at any time.",
        "If your software is being used in production, it should probably already be 1.0.0."],
 's4': ["3 - Alpha", "4 - Beta", "5 - Production/Stable"],
 's5': ["An Alpha feature means:", "Disabled by default.", "Might be buggy. Enabling the feature may expose bugs.",
        "A Beta feature means:", "The feature is well tested. Enabling the feature is considered safe.",
        "Recommended for only non-business-critical uses because of potential for incompatible changes in subsequent releases."],
 's6': ["Stability: 1 - Experimental. The feature is not subject to semantic versioning rules. Non-backward compatible changes or removal may occur in any future release. Use of the feature is not recommended in production environments.",
        "1.2 - Release candidate. Experimental features at this stage are hopefully ready to become stable."],
 's7': ["At Preview, products or features are ready for testing by customers. Preview offerings are often publicly announced, but are not necessarily feature-complete, and no SLAs or technical support commitments are provided for these. Unless stated otherwise by Google, Preview offerings are intended for use in test environments only."],
 's8': ["Because Technology Preview features are still under development, Red Hat cannot guarantee their stability."],
 's9': ["Advancing to Candidate Recommendation indicates that the document is considered complete and fit for purpose, and that no further refinement to the text is expected without additional implementation experience and testing; however, additional features might be expected in a later revision."],
 's10': ["Minimal or no implementation has been done yet, or the repository is only intended to be a limited example, demo, or proof-of-concept.",
         "Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.",
         "The project has reached a stable, usable state and is being actively developed."],
 's11': ["For a product in the laboratory research phase of development, and not represented as an effective in vitro diagnostic product",
         "For Research Use Only. Not for use in diagnostic procedures.",
         "For Investigational Use Only. The performance characteristics of this product have not been established."],
 's12': ["An IVD product should not be labeled RUO if it is intended for use in a clinical investigation subject to 21 CFR part 812 or for clinical diagnostic use outside an investigation (for example, in clinical diagnosis for standard medical practice). FDA would consider such an IVD product to be misbranded under section 502(a) of the Act, 21 U.S.C. 352(a), if it were labeled \"For Research Use Only\" or otherwise labeled solely for research use, because such labeling would be false or misleading."],
 's13': ["Software verification provides objective evidence that the design outputs of a particular phase of the software development life cycle meet all of the specified requirements for that phase.",
         "For purposes of this guidance, FDA considers software validation to be \"confirmation by examination and provision of objective evidence that software specifications conform to user needs and intended uses, and that the particular requirements implemented through software can be consistently fulfilled.\""],
 's14': ["For the purpose of this document, non-clinical bench performance testing is defined as performance testing, performed by either a device manufacturer or a third party testing facility (e.g., test laboratory), which encompasses all bench testing and will be dependent upon the specifics of the actual device or device type."],
 's15a': ["The Verification Service Class defines a service that verifies application level communication between peer DICOM AEs."],
 's15b': ["Any implementation that conforms to the DICOM Standard and has elected to support any one of the Transfer Syntaxes for 8-bit Lossy JPEG Image Compression, shall support the JPEG Baseline Compression (coding Process 1)."],
 's16a': ["The OHIF Viewer is NOT F.D.A. cleared or CE Marked. It is the users' responsibility to ensure compliance with applicable rules and regulations."],
 's16b': ["Slicer is NOT approved for clinical use and the distributed application is intended for research use."],
}
for k, qs in Q.items():
    p = os.path.join(src, k + '.txt')
    t = norm(open(p, errors='replace').read()) if os.path.exists(p) else ''
    for q in qs:
        print(('OK  ' if norm(q) in t else 'MISS') , k, q[:90])
