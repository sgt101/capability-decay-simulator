# Capability Decay Simulator

[![LHS Shows a simulation without AI, yeilding a steady state with strong expertise and relatively low centralisation, RHS shows an AI simulation with low expertise and high centralisation](doc/images/no-ai-vs-ai.png)](doc/images/no-ai-vs-ai.png).

## Quick start.

An Agent-based model of institutions and humans where reliance on AI erodes the
real expertise (`E`) behind their output over time.

You will need to download this repository and then you do the following:

- See src/simulator.html for the interactive visualizer.

- Run the experiments "src/run_experiments.sh --workers 14"

- Run "node src/build_report.js" and you can then browse [report.html](report.html) to review your results

See [machine_generated.md](machine_generated.md) for an (mostly AI) generated set of more detailed instructions for setting up and running batch experiements.

Running the batchs takes about 1hr 40 on a MBP-5 with 48GB ram, and you will need a few GB of disk free as the results files are quite big.

## Background

[![A visualisation of risk propagation in the financial system](doc/images/dynamic-matrix-bw.svg)](doc/images/dynamic-matrix-bw.svg).

The question that motivated the development of this simulation was "what significant harms could arise from the deployment of modern AI by actors in the Financial system". A significant harm is considered as something that would create political pressure, for example the kind of harm to an individual or small group that would make them the focus of national attention (think - [https://en.wikipedia.org/wiki/British_Post_Office_scandal](subpost masters) in the uk) or create widespread economic damage that might not be grievous for an individual but is noticable at regional, national or super national levels (for example the [https://en.wikipedia.org/wiki/2008_financial_crisis](GFC)).

There are a lot of different ways that risks to the system could be created, (systematic technical errors, concentration, loss of market oversight, sovereign, political, misalignment, cyber, fraud,...) but psychological and cultural mechanisms are the focus of this work.

This focus motivated an analysis of different psychological, cultural and insitutional dynamics that could create significant risks (as above) by propagating from individuals and insitutions through the fundamental functions of the system (we chose the well known {Bodie and Merton 98} framework).

One of these risk factors is the potential for AI to impede human learning, particularly the acquisition of expertise. The assumption is that expertise is required by the financial system both during it's normal functioning to create maximal efficiency (getting as close to market efficiency as non-rational agents might) but also to effectively manage crisis situations. If the system fails in a crisis and (for example) the payments system collapses because there was insufficient expertise to shape an effective set of mitigations significant harm will clearly accrue (people die, the economy collapses, chaos reigns...).

This simulation models how AI might impact the development and transmission of expertise. There are a bunch of caveats about its validity and working but it's now at a point where it produces interesting behaviours and so it's time to share it.
