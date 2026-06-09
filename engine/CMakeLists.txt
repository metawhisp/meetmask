# MEETAMASK render engine — standalone CEF offscreen app.
# Built against the CEF binary distribution in ../cef/dist.

cmake_minimum_required(VERSION 3.21)
project(meetamask_engine)

# Locate the CEF binary distribution.
set(CEF_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../cef/dist" CACHE PATH "Path to CEF binary distribution")
set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)

# Build the libcef_dll_wrapper static library.
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)

# Engine + helper sources.
set(ENGINE_SRCS
  main.mm
  engine_app.cc
  engine_app.h
  engine_handler.mm
  engine_handler.h
  frame_shm.mm
  frame_shm.h
  )
set(ENGINE_HELPER_SRCS
  process_helper_mac.cc
  )

set(CEF_TARGET "MEETAMASKEngine")
set(CEF_HELPER_TARGET "MEETAMASKEngine_Helper")
set(CEF_HELPER_OUTPUT_NAME "MEETAMASKEngine Helper")

# Determine the target output directory.
SET_CEF_TARGET_OUT_DIR()

# Build with ARC.
list(APPEND CEF_COMPILER_FLAGS -fobjc-arc)

# Output path for the main app bundle.
set(CEF_APP "${CEF_TARGET_OUT_DIR}/${CEF_TARGET}.app")

# Variables referenced from the Info.plist file.
set(EXECUTABLE_NAME "${CEF_TARGET}")
set(PRODUCT_NAME "${CEF_TARGET}")

# Main app bundle target.
add_executable(${CEF_TARGET} MACOSX_BUNDLE ${ENGINE_SRCS})
SET_EXECUTABLE_TARGET_PROPERTIES(${CEF_TARGET})
add_dependencies(${CEF_TARGET} libcef_dll_wrapper)
target_link_libraries(${CEF_TARGET} libcef_dll_wrapper ${CEF_STANDARD_LIBS})
set_target_properties(${CEF_TARGET} PROPERTIES
  MACOSX_BUNDLE_INFO_PLIST ${CMAKE_CURRENT_SOURCE_DIR}/mac/Info.plist.in
  )

# Copy the CEF framework into the Frameworks directory.
COPY_MAC_FRAMEWORK("${CEF_TARGET}" "${CEF_BINARY_DIR}" "${CEF_APP}")

# Create the Helper app bundles (one per CEF sub-process type).
foreach(_suffix_list ${CEF_HELPER_APP_SUFFIXES})
  string(REPLACE ":" ";" _suffix_list ${_suffix_list})
  list(GET _suffix_list 0 _name_suffix)
  list(GET _suffix_list 1 _target_suffix)
  list(GET _suffix_list 2 _plist_suffix)

  set(_helper_target "${CEF_HELPER_TARGET}${_target_suffix}")
  set(_helper_output_name "${CEF_HELPER_OUTPUT_NAME}${_name_suffix}")

  # Generate a Helper-specific Info.plist.
  set(_helper_info_plist "${CMAKE_CURRENT_BINARY_DIR}/helper-Info${_target_suffix}.plist")
  file(READ "${CMAKE_CURRENT_SOURCE_DIR}/mac/helper-Info.plist.in" _plist_contents)
  string(REPLACE "\${EXECUTABLE_NAME}" "${_helper_output_name}" _plist_contents ${_plist_contents})
  string(REPLACE "\${PRODUCT_NAME}" "${_helper_output_name}" _plist_contents ${_plist_contents})
  string(REPLACE "\${BUNDLE_ID_SUFFIX}" "${_plist_suffix}" _plist_contents ${_plist_contents})
  string(REPLACE "\${VERSION_SHORT}" "0.1" _plist_contents ${_plist_contents})
  file(WRITE ${_helper_info_plist} ${_plist_contents})

  add_executable(${_helper_target} MACOSX_BUNDLE ${ENGINE_HELPER_SRCS})
  SET_EXECUTABLE_TARGET_PROPERTIES(${_helper_target})
  add_dependencies(${_helper_target} libcef_dll_wrapper)
  target_link_libraries(${_helper_target} libcef_dll_wrapper ${CEF_STANDARD_LIBS})
  set_target_properties(${_helper_target} PROPERTIES
    MACOSX_BUNDLE_INFO_PLIST ${_helper_info_plist}
    OUTPUT_NAME ${_helper_output_name}
    )

  add_dependencies(${CEF_TARGET} "${_helper_target}")

  # Copy the Helper app bundle into the main app's Frameworks directory.
  add_custom_command(
    TARGET ${CEF_TARGET}
    POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${CEF_TARGET_OUT_DIR}/${_helper_output_name}.app"
            "${CEF_APP}/Contents/Frameworks/${_helper_output_name}.app"
    VERBATIM
    )
endforeach()
