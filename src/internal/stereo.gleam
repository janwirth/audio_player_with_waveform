import gleam/dynamic.{type Dynamic}
import lustre
import lustre/attribute.{id}
import lustre/effect
import lustre/element.{type Element}
import lustre/element/html.{div}

@external(javascript, "../stereo_ffi.mjs", "mountStereo")
fn mount(root: Dynamic, inner_id: String) -> Nil

pub const element_name: String = "audio-player-stereo"

const inner_id: String = "apww-stereo-root"

pub type Msg {
  NoOp
}

pub type Model =
  Nil

fn init(_flags: Nil) -> #(Model, effect.Effect(Msg)) {
  #(Nil, effect.after_paint(fn(_dispatch, root) { mount(root, inner_id) }))
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
