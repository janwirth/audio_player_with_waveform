import gleam/dynamic.{type Dynamic}
import lustre
import lustre/attribute.{id}
import lustre/effect
import lustre/element.{type Element}
import lustre/element/html.{div}

@external(javascript, "../audio_ffi.mjs", "installBus")
fn install_bus() -> Nil

@external(javascript, "../audio_ffi.mjs", "attachAudioToHost")
fn attach_audio(root: Dynamic, inner_id: String) -> Dynamic

pub const element_name: String = "audio-player-host"

const inner_id: String = "apww-host-root"

pub type Msg {
  NoOp
}

pub type Model =
  Nil

fn init(_flags: Nil) -> #(Model, effect.Effect(Msg)) {
  #(
    Nil,
    effect.after_paint(fn(_dispatch, root) {
      install_bus()
      let _ = attach_audio(root, inner_id)
      Nil
    }),
  )
}

fn update(_model: Model, _msg: Msg) -> #(Model, effect.Effect(Msg)) {
  #(Nil, effect.none())
}

fn view(_model: Model) -> Element(Msg) {
  div([id(inner_id)], [])
}

pub fn register() -> Result(Nil, lustre.Error) {
  case lustre.is_registered(element_name) {
    True -> Ok(Nil)
    False ->
      lustre.register(lustre.component(init, update, view, []), element_name)
  }
}
